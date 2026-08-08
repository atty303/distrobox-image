import { parse } from "@std/toml";
import type { ImageManifest, SmokeCommand, Trigger, TriggerRole } from "./types.ts";

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
  "reference_smoke",
]);
const COMMON_TRIGGER_KEYS = [
  "id",
  "type",
  "role",
  "build_arg",
  "revision_arg",
  "label",
  "label_source",
];
const TYPE_KEYS: Record<string, Set<string>> = {
  "github-release": new Set([
    ...COMMON_TRIGGER_KEYS,
    "repository",
    "channel",
    "asset_pattern",
    "url_arg",
    "checksum_arg",
  ]),
  "aur-version": new Set([...COMMON_TRIGGER_KEYS, "package", "matches"]),
  "oci-digest": new Set([...COMMON_TRIGGER_KEYS, "image", "monthly"]),
  "git-commit": new Set([...COMMON_TRIGGER_KEYS, "repository", "ref"]),
};
const ROLES = new Set<TriggerRole>(["build", "gate", "input"]);

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a table`);
  }
  return value as Record<string, unknown>;
}
function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) throw new Error(`${label} must be a non-empty string`);
  return value;
}
function unknownKeys(value: Record<string, unknown>, allowed: Set<string>, label: string) {
  const bad = Object.keys(value).filter((key) => !allowed.has(key));
  if (bad.length) throw new Error(`${label} has unknown field(s): ${bad.join(", ")}`);
}
function smokeCommands(value: unknown, label: string): SmokeCommand[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${label} must be an array of tables`);
  return value.map((entry, index) => {
    const table = record(entry, `${label}[${index}]`);
    unknownKeys(table, new Set(["command"]), `${label}[${index}]`);
    if (
      !Array.isArray(table.command) || !table.command.length ||
      table.command.some((part) => typeof part !== "string" || !part)
    ) throw new Error(`${label}[${index}].command must be a non-empty string array`);
    return { command: table.command as string[] };
  });
}
async function mustExist(path: string, label: string) {
  try {
    await Deno.stat(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) throw new Error(`${label} does not exist: ${path}`);
    throw error;
  }
}

function parseTrigger(raw: unknown, path: string, index: number): Trigger {
  const label = `${path} trigger ${index}`;
  const table = record(raw, label);
  const type = requiredString(table.type, `${label}.type`);
  const allowed = TYPE_KEYS[type];
  if (!allowed) throw new Error(`${label}: unknown trigger type ${type}`);
  unknownKeys(table, allowed, label);
  const role = requiredString(table.role, `${label}.role`) as TriggerRole;
  if (!ROLES.has(role)) throw new Error(`${label}: unknown trigger role ${role}`);
  const common = {
    id: requiredString(table.id, `${label}.id`),
    role,
    build_arg: table.build_arg as string | undefined,
    revision_arg: table.revision_arg as string | undefined,
    label: table.label as string | undefined,
    label_source: table.label_source as "value" | "revision" | undefined,
  };
  if (common.label_source && !["value", "revision"].includes(common.label_source)) {
    throw new Error(`${label}: invalid label_source`);
  }
  switch (type) {
    case "github-release":
      return {
        ...common,
        type,
        repository: requiredString(table.repository, `${label}.repository`),
        channel: table.channel as "stable" | "prerelease" | undefined,
        asset_pattern: table.asset_pattern as string | undefined,
        url_arg: table.url_arg as string | undefined,
        checksum_arg: table.checksum_arg as string | undefined,
      };
    case "aur-version":
      return {
        ...common,
        type,
        package: requiredString(table.package, `${label}.package`),
        matches: table.matches as string | undefined,
      };
    case "oci-digest":
      return {
        ...common,
        type,
        image: requiredString(table.image, `${label}.image`),
        monthly: table.monthly as boolean | undefined,
      };
    case "git-commit":
      return {
        ...common,
        type,
        repository: requiredString(table.repository, `${label}.repository`),
        ref: table.ref as string | undefined,
      };
    default:
      throw new Error(`${label}: unsupported trigger type`);
  }
}

export async function loadManifest(path: string): Promise<ImageManifest> {
  const raw = record(parse(await Deno.readTextFile(path)), path);
  unknownKeys(raw, ROOT_KEYS, path);
  if (raw.schema !== 2) throw new Error(`${path}: unsupported schema`);
  const directory = path.slice(0, path.lastIndexOf("/"));
  const triggers = ((raw.triggers as unknown[]) ?? []).map((item, index) =>
    parseTrigger(item, path, index)
  );
  if (!triggers.length) throw new Error(`${path}: at least one trigger is required`);
  const ids = triggers.map((trigger) => trigger.id);
  if (new Set(ids).size !== ids.length) throw new Error(`${path}: duplicate trigger id`);
  for (const trigger of triggers) {
    if (trigger.role === "gate" && (trigger.type !== "aur-version" || !trigger.matches)) {
      throw new Error(`${path}: gate ${trigger.id} requires matches`);
    }
    if (trigger.role === "gate" && !ids.includes((trigger as { matches?: string }).matches!)) {
      throw new Error(`${path}: ${trigger.id} has invalid gate match`);
    }
    if (trigger.label_source === "revision" && trigger.type === "git-commit") {
      throw new Error(`${path}: git-commit labels use value, not revision`);
    }
    if (
      trigger.type === "github-release" && trigger.asset_pattern &&
      (!trigger.url_arg || !trigger.checksum_arg)
    ) {
      throw new Error(`${path}: ${trigger.id} asset requires url_arg and checksum_arg`);
    }
  }

  const parentRaw = raw.parent ? record(raw.parent, `${path}.parent`) : undefined;
  if (parentRaw) unknownKeys(parentRaw, new Set(["image", "external", "propagation"]), "parent");
  if (parentRaw && Boolean(parentRaw.image) === Boolean(parentRaw.external)) {
    throw new Error(`${path}: parent requires exactly one of image or external`);
  }
  if (parentRaw?.external && !String(parentRaw.external).includes("@sha256:")) {
    throw new Error(`${path}: external parent must be digest pinned`);
  }
  if (parentRaw && parentRaw.propagation !== "on-next-build") {
    throw new Error(`${path}: parent propagation must be on-next-build`);
  }

  const referenceRaw = raw.reference ? record(raw.reference, `${path}.reference`) : undefined;
  if (referenceRaw) {
    unknownKeys(referenceRaw, new Set(["file", "section", "nvidia_section"]), "reference");
  }
  const manifest: ImageManifest = {
    schema: 2,
    name: requiredString(raw.name, `${path}.name`),
    repository: requiredString(raw.repository, `${path}.repository`),
    context: requiredString(raw.context, `${path}.context`),
    containerfile: requiredString(raw.containerfile, `${path}.containerfile`),
    tag: requiredString(raw.tag, `${path}.tag`),
    triggers,
    smoke: smokeCommands(raw.smoke, `${path}.smoke`),
    reference_smoke: smokeCommands(raw.reference_smoke, `${path}.reference_smoke`),
    directory,
    parent: parentRaw
      ? {
        image: parentRaw.image as string | undefined,
        external: parentRaw.external as string | undefined,
        propagation: "on-next-build",
      }
      : undefined,
    reference: referenceRaw
      ? {
        file: requiredString(referenceRaw.file, `${path}.reference.file`),
        section: requiredString(referenceRaw.section, `${path}.reference.section`),
        nvidia_section: referenceRaw.nvidia_section as string | undefined,
      }
      : undefined,
  };
  if (!/^ghcr\.io\/[a-z0-9_.-]+\/[a-z0-9_.-]+$/.test(manifest.repository)) {
    throw new Error(`${path}: invalid GHCR repository`);
  }
  if (!manifest.smoke.length) throw new Error(`${path}: image smoke commands are required`);
  if (!manifest.tag.includes("{event_hash8}")) throw new Error(`${path}: tag requires event_hash8`);
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
  await mustExist(`${directory}/${manifest.containerfile}`, `${path}.containerfile`);
  if (manifest.reference) {
    await mustExist(manifest.reference.file, `${path}.reference.file`);
    const text = await Deno.readTextFile(manifest.reference.file);
    for (
      const section of [manifest.reference.section, manifest.reference.nvidia_section].filter(
        Boolean,
      )
    ) {
      if (!text.split("\n").includes(`[${section}]`)) {
        throw new Error(`${path}: reference section ${section} is missing`);
      }
    }
  } else if (manifest.reference_smoke.length) {
    throw new Error(`${path}: reference_smoke requires reference`);
  }
  return manifest;
}

export async function discoverManifests(root = "."): Promise<ImageManifest[]> {
  const paths: string[] = [];
  for await (const entry of Deno.readDir(root)) {
    if (!entry.isDirectory || entry.name.startsWith(".")) continue;
    const path = `${root}/${entry.name}/image.toml`;
    try {
      await Deno.stat(path);
      paths.push(path);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
  }
  const manifests = await Promise.all(paths.sort().map(loadManifest));
  validateGraph(manifests);
  return topologicalManifests(manifests);
}

export function validateGraph(manifests: ImageManifest[]) {
  const names = new Set<string>();
  const repositories = new Set<string>();
  for (const manifest of manifests) {
    if (names.has(manifest.name)) throw new Error(`duplicate image ${manifest.name}`);
    if (repositories.has(manifest.repository)) {
      throw new Error(`duplicate repository ${manifest.repository}`);
    }
    names.add(manifest.name);
    repositories.add(manifest.repository);
  }
  for (const manifest of manifests) {
    if (manifest.parent?.image && !names.has(manifest.parent.image)) {
      throw new Error(`${manifest.name}: missing parent ${manifest.parent.image}`);
    }
  }
  topologicalManifests(manifests);
}

export function topologicalManifests(manifests: ImageManifest[]): ImageManifest[] {
  const byName = new Map(manifests.map((manifest) => [manifest.name, manifest]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const ordered: ImageManifest[] = [];
  const visit = (name: string) => {
    if (visiting.has(name)) throw new Error(`dependency cycle at ${name}`);
    if (visited.has(name)) return;
    visiting.add(name);
    const manifest = byName.get(name)!;
    if (manifest.parent?.image) visit(manifest.parent.image);
    visiting.delete(name);
    visited.add(name);
    ordered.push(manifest);
  };
  for (const manifest of manifests) visit(manifest.name);
  return ordered;
}
