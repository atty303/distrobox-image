import { parse } from "@std/toml";
import type { ImageManifest, Trigger, TriggerRole, TriggerType } from "./types.ts";

const ROOT_KEYS = new Set([
  "schema",
  "name",
  "repository",
  "context",
  "containerfile",
  "tag",
  "parent",
  "triggers",
  "reference",
  "smoke",
  "lock_fields",
]);
const TRIGGER_KEYS = new Set([
  "id",
  "type",
  "role",
  "repository",
  "package",
  "image",
  "channel",
  "matches",
  "paths",
  "monthly",
  "build_arg",
  "revision_arg",
  "asset_pattern",
  "url_arg",
  "checksum_arg",
  "lock_prefix",
  "ref",
]);
const TYPES = new Set<TriggerType>([
  "github-release",
  "aur-version",
  "oci-digest",
  "repo-path",
  "git-commit",
  "manual",
]);
const ROLES = new Set<TriggerRole>(["build", "gate", "input"]);

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a table`);
  }
  return value as Record<string, unknown>;
}
function string(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) throw new Error(`${label} must be a non-empty string`);
  return value;
}
function strings(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
    throw new Error(`${label} must be an array of strings`);
  }
  return value as string[];
}
function unknownKeys(value: Record<string, unknown>, allowed: Set<string>, label: string) {
  const bad = Object.keys(value).filter((key) => !allowed.has(key));
  if (bad.length) throw new Error(`${label} has unknown field(s): ${bad.join(", ")}`);
}

export async function loadManifest(path: string): Promise<ImageManifest> {
  const raw = record(parse(await Deno.readTextFile(path)), path);
  unknownKeys(raw, ROOT_KEYS, path);
  if (raw.schema !== 1) throw new Error(`${path}: unsupported schema`);
  const directory = path.slice(0, path.lastIndexOf("/"));
  const triggers = (raw.triggers as unknown[] | undefined)?.map((item, index) => {
    const trigger = record(item, `${path} trigger ${index}`);
    unknownKeys(trigger, TRIGGER_KEYS, `${path} trigger ${index}`);
    const type = string(trigger.type, "trigger.type") as TriggerType;
    const role = string(trigger.role, "trigger.role") as TriggerRole;
    if (!TYPES.has(type)) throw new Error(`${path}: unknown trigger type ${type}`);
    if (!ROLES.has(role)) throw new Error(`${path}: unknown trigger role ${role}`);
    return { ...trigger, id: string(trigger.id, "trigger.id"), type, role } as Trigger;
  }) ?? [];
  const ids = triggers.map((t) => t.id);
  if (new Set(ids).size !== ids.length) throw new Error(`${path}: duplicate trigger id`);
  for (const trigger of triggers) {
    if (trigger.type === "github-release" && !trigger.repository) {
      throw new Error(`${path}: ${trigger.id} requires repository`);
    }
    if (trigger.type === "aur-version" && !trigger.package) {
      throw new Error(`${path}: ${trigger.id} requires package`);
    }
    if (trigger.type === "oci-digest" && !trigger.image) {
      throw new Error(`${path}: ${trigger.id} requires image`);
    }
    if (trigger.type === "repo-path" && !trigger.paths?.length) {
      throw new Error(`${path}: ${trigger.id} requires paths`);
    }
    if (trigger.type === "git-commit" && !trigger.repository) {
      throw new Error(`${path}: ${trigger.id} requires repository`);
    }
    if (trigger.role === "gate" && (!trigger.matches || !ids.includes(trigger.matches))) {
      throw new Error(`${path}: ${trigger.id} has invalid gate match`);
    }
  }
  const parent = raw.parent ? record(raw.parent, "parent") : undefined;
  if (parent) unknownKeys(parent, new Set(["image", "external", "propagation"]), "parent");
  const reference = raw.reference ? record(raw.reference, "reference") : undefined;
  if (reference) {
    unknownKeys(reference, new Set(["file", "section", "nvidia_section"]), "reference");
  }
  const smoke = ((raw.smoke as unknown[]) ?? []).map((s) => {
    const table = record(s, "smoke");
    unknownKeys(table, new Set(["command"]), "smoke");
    return { command: strings(table.command, "smoke.command") };
  });
  const manifest: ImageManifest = {
    schema: 1,
    name: string(raw.name, "name"),
    repository: string(raw.repository, "repository"),
    context: string(raw.context, "context"),
    containerfile: string(raw.containerfile, "containerfile"),
    tag: string(raw.tag, "tag"),
    triggers,
    smoke,
    lock_fields: strings(raw.lock_fields ?? [], "lock_fields"),
    directory,
    parent: parent
      ? {
        image: parent.image as string | undefined,
        external: parent.external as string | undefined,
        propagation: string(parent.propagation, "parent.propagation") as
          | "immediate"
          | "on-next-build",
      }
      : undefined,
    reference: reference
      ? {
        file: string(reference.file, "reference.file"),
        section: string(reference.section, "reference.section"),
        nvidia_section: reference.nvidia_section as string | undefined,
      }
      : undefined,
  };
  if (!/^ghcr\.io\/[a-z0-9_.-]+\/[a-z0-9_.-]+$/.test(manifest.repository)) {
    throw new Error(`${path}: invalid GHCR repository`);
  }
  if (manifest.parent?.external && !manifest.parent.external.includes("@sha256:")) {
    throw new Error(`${path}: external parent must be digest pinned`);
  }
  if (manifest.parent && manifest.parent.propagation !== "on-next-build") {
    throw new Error(`${path}: unsupported parent propagation`);
  }
  if (!manifest.tag.includes("{event_hash8}")) {
    throw new Error(`${path}: tag must contain event_hash8`);
  }
  const variables = [...manifest.tag.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]);
  const allowedVariables = new Set([
    "event_hash8",
    "year",
    "month",
    ...triggers.map((trigger) => `${trigger.id}.version`),
  ]);
  for (const variable of variables) {
    if (!allowedVariables.has(variable)) {
      throw new Error(`${path}: undefined tag variable ${variable}`);
    }
  }
  return manifest;
}

export async function discoverManifests(root = "."): Promise<ImageManifest[]> {
  const paths: string[] = [];
  for await (const entry of Deno.readDir(root)) {
    if (entry.isDirectory && !entry.name.startsWith(".")) {
      const path = `${root}/${entry.name}/image.toml`;
      try {
        await Deno.stat(path);
        paths.push(path);
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
      }
    }
  }
  paths.sort();
  const manifests = await Promise.all(paths.map(loadManifest));
  validateGraph(manifests);
  return manifests;
}

export function validateGraph(manifests: ImageManifest[]) {
  const names = new Set<string>();
  for (const manifest of manifests) {
    if (names.has(manifest.name)) throw new Error(`duplicate image ${manifest.name}`);
    names.add(manifest.name);
  }
  for (const manifest of manifests) {
    if (manifest.parent?.image && !names.has(manifest.parent.image)) {
      throw new Error(`${manifest.name}: missing parent ${manifest.parent.image}`);
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byName = new Map(manifests.map((m) => [m.name, m]));
  const visit = (name: string) => {
    if (visiting.has(name)) throw new Error(`dependency cycle at ${name}`);
    if (visited.has(name)) return;
    visiting.add(name);
    const parent = byName.get(name)?.parent?.image;
    if (parent) visit(parent);
    visiting.delete(name);
    visited.add(name);
  };
  for (const name of names) visit(name);
}
