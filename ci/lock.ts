import { parse, stringify } from "@std/toml";
import type { ImageLock, ImageManifest } from "./types.ts";

export async function loadLock(path: string, manifest?: ImageManifest): Promise<ImageLock> {
  const text = await Deno.readTextFile(path);
  const value =
    (text.trimStart().startsWith("{") ? JSON.parse(text) : parse(text)) as unknown as ImageLock;
  if (value.schema !== 1 || !value.image || !value.inputs || !value.build_args || !value.expected) {
    throw new Error(`${path}: invalid lock`);
  }
  if (manifest && value.image !== manifest.name) {
    throw new Error(`${path}: image does not match ${manifest.name}`);
  }
  for (const field of manifest?.lock_fields ?? []) {
    if (!(field in value.inputs)) throw new Error(`${path}: missing locked input ${field}`);
  }
  for (const [key, val] of Object.entries(value.build_args)) {
    if (typeof val !== "string" || !val) throw new Error(`${path}: invalid build arg ${key}`);
  }
  const base = value.build_args.BASE_IMAGE;
  if (base && !base.includes("@sha256:")) throw new Error(`${path}: BASE_IMAGE is not immutable`);
  for (const [key, input] of Object.entries(value.inputs)) {
    if (key.endsWith("_commit") && !/^[0-9a-f]{40}$/.test(input)) {
      throw new Error(`${path}: ${key} is not a commit`);
    }
    if (key.endsWith("_sha256") && !/^[0-9a-f]{64}$/.test(input)) {
      throw new Error(`${path}: ${key} is not SHA-256`);
    }
    if (key.endsWith("_url") && !/^https:\/\//.test(input)) {
      throw new Error(`${path}: ${key} is not HTTPS`);
    }
  }
  return value;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map((
        [k, v],
      ) => [k, canonical(v)]),
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
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
export function renderLock(lock: ImageLock): string {
  return stringify(lock as unknown as Record<string, unknown>);
}
