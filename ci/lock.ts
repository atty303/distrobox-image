import { parse, stringify } from "@std/toml";
import type { ImageLock, ImageManifest, Trigger } from "./types.ts";

const ROOT_KEYS = new Set(["schema", "image", "inputs", "build_args", "expected"]);

function expectedInputKeys(manifest: ImageManifest): Set<string> {
  const keys = new Set(["parent", "arch_snapshot"]);
  for (const trigger of manifest.triggers) {
    const id = trigger.id.replaceAll("-", "_");
    switch (trigger.type) {
      case "github-release":
        keys.add(`${id}_version`);
        if (trigger.revision_arg) keys.add(`${id}_commit`);
        if (trigger.asset_pattern) {
          keys.add(`${id}_url`);
          keys.add(`${id}_sha256`);
        }
        break;
      case "aur-version":
        keys.add(`${id}_version`);
        keys.add(`${id}_commit`);
        break;
      case "oci-digest":
        keys.add(`${id}_digest`);
        break;
      case "git-commit":
        keys.add(`${id}_commit`);
        break;
    }
  }
  return keys;
}

function expectedBuildArgKeys(manifest: ImageManifest): Set<string> {
  const keys = new Set(["BASE_IMAGE", "ARCH_SNAPSHOT"]);
  for (const trigger of manifest.triggers) {
    for (const key of [trigger.build_arg, trigger.revision_arg]) if (key) keys.add(key);
    if (trigger.type === "github-release") {
      for (const key of [trigger.url_arg, trigger.checksum_arg]) if (key) keys.add(key);
    }
  }
  return keys;
}

function exactKeys(actual: Record<string, string>, expected: Set<string>, label: string) {
  const missing = [...expected].filter((key) => !(key in actual));
  const extra = Object.keys(actual).filter((key) => !expected.has(key));
  if (missing.length) throw new Error(`${label}: missing ${missing.join(", ")}`);
  if (extra.length) throw new Error(`${label}: unknown ${extra.join(", ")}`);
}

function triggerInputValue(lock: ImageLock, trigger: Trigger): string {
  const id = trigger.id.replaceAll("-", "_");
  if (trigger.label_source === "revision") return lock.inputs[`${id}_commit`];
  return trigger.type === "git-commit"
    ? lock.inputs[`${id}_commit`]
    : trigger.type === "oci-digest"
    ? lock.inputs[`${id}_digest`]
    : lock.inputs[`${id}_version`];
}

export async function loadLock(path: string, manifest?: ImageManifest): Promise<ImageLock> {
  const text = await Deno.readTextFile(path);
  const raw = (text.trimStart().startsWith("{") ? JSON.parse(text) : parse(text)) as Record<
    string,
    unknown
  >;
  const badRoot = Object.keys(raw).filter((key) => !ROOT_KEYS.has(key));
  if (badRoot.length) throw new Error(`${path}: unknown field(s): ${badRoot.join(", ")}`);
  if (raw.schema !== 2 || typeof raw.image !== "string") throw new Error(`${path}: invalid lock`);
  for (const table of ["inputs", "build_args", "expected"] as const) {
    if (!raw[table] || typeof raw[table] !== "object" || Array.isArray(raw[table])) {
      throw new Error(`${path}: ${table} must be a table`);
    }
    for (const [key, value] of Object.entries(raw[table] as Record<string, unknown>)) {
      if (typeof value !== "string" || !value) throw new Error(`${path}: invalid ${table}.${key}`);
    }
  }
  const lock = raw as unknown as ImageLock;
  if (!manifest) return lock;
  if (lock.image !== manifest.name) {
    throw new Error(`${path}: image does not match ${manifest.name}`);
  }
  exactKeys(lock.inputs, expectedInputKeys(manifest), `${path}.inputs`);
  exactKeys(lock.build_args, expectedBuildArgKeys(manifest), `${path}.build_args`);
  const labels = new Set(
    manifest.triggers.flatMap((trigger) => trigger.label ? [trigger.label] : []),
  );
  exactKeys(lock.expected, labels, `${path}.expected`);
  for (const trigger of manifest.triggers) {
    if (trigger.label && lock.expected[trigger.label] !== triggerInputValue(lock, trigger)) {
      throw new Error(`${path}: expected label ${trigger.label} does not match locked input`);
    }
  }
  if (!lock.build_args.BASE_IMAGE.includes("@sha256:")) {
    throw new Error(`${path}: BASE_IMAGE is not immutable`);
  }
  if (lock.build_args.BASE_IMAGE !== lock.inputs.parent) {
    throw new Error(`${path}: BASE_IMAGE does not match inputs.parent`);
  }
  if (lock.build_args.ARCH_SNAPSHOT !== lock.inputs.arch_snapshot) {
    throw new Error(`${path}: ARCH_SNAPSHOT does not match inputs.arch_snapshot`);
  }
  for (const [key, input] of Object.entries(lock.inputs)) {
    if (key.endsWith("_commit") && !/^[0-9a-f]{40}$/.test(input)) {
      throw new Error(`${path}: ${key} is not a commit`);
    }
    if (key.endsWith("_sha256") && !/^[0-9a-f]{64}$/.test(input)) {
      throw new Error(`${path}: ${key} is not SHA-256`);
    }
    if (key.endsWith("_digest") && !/^sha256:[0-9a-f]{64}$/.test(input)) {
      throw new Error(`${path}: ${key} is not an OCI digest`);
    }
    if (key.endsWith("_url") && !/^https:\/\//.test(input)) {
      throw new Error(`${path}: ${key} is not HTTPS`);
    }
  }
  return lock;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(
        ([key, item]) => [key, canonical(item)],
      ),
    );
  }
  return value;
}
export function canonicalLock(lock: ImageLock): string {
  return JSON.stringify(canonical(lock));
}
export async function lockHash(lock: ImageLock): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalLock(lock)),
  );
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
export function renderLock(lock: ImageLock): string {
  return stringify(lock as unknown as Record<string, unknown>);
}
