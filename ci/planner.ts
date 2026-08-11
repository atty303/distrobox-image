import type { ImageLock, ImageManifest, PlanItem, RegistryState, ResolvedValue } from "./types.ts";

const EVENT_SCHEMA = 3;
export interface PlanOptions {
  force?: boolean;
  nonce?: string;
  manualReason?: string;
}
async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
export async function eventKey(
  manifest: ImageManifest,
  resolved: Record<string, ResolvedValue>,
  sourceHash: string,
  nonce?: string,
): Promise<string> {
  const build = manifest.triggers.filter((trigger) => trigger.role === "build").map((trigger) => {
    const result = resolved[trigger.id];
    if (trigger.type === "aur-version" && !result?.revision) {
      throw new Error(`${manifest.name}: ${trigger.id} has no AUR commit`);
    }
    const identity = trigger.type === "aur-version" ? result.revision : result?.value;
    return [trigger.id, identity];
  }).sort(([a], [b]) => a!.localeCompare(b!));
  return await sha256(JSON.stringify({
    eventSchema: EVENT_SCHEMA,
    manifestSchema: manifest.schema,
    image: manifest.name,
    build,
    sourceHash,
    nonce: nonce || undefined,
  }));
}
export function renderTag(
  template: string,
  resolved: Record<string, ResolvedValue>,
  hash: string,
): string {
  const values: Record<string, string> = {
    event_hash8: hash.slice(0, 8),
  };
  for (const [id, result] of Object.entries(resolved)) {
    values[`${id}.version`] = result.value.replace(/^v/, "").replace(/[^A-Za-z0-9_.-]/g, "-");
  }
  const tag = template.replace(/\{([^}]+)\}/g, (_, key) => {
    if (!(key in values)) throw new Error(`undefined tag variable ${key}`);
    return values[key];
  });
  if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(tag)) throw new Error(`invalid OCI tag ${tag}`);
  return tag;
}
export function tagPattern(template: string): RegExp {
  const escaped = template.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = escaped
    .replace("\\{event_hash8\\}", "[0-9a-f]{8}")
    .replace(/\\\{[^}]+\\\}/g, "[A-Za-z0-9_.-]+");
  return new RegExp(`^${pattern}$`);
}
export async function planImage(
  manifest: ImageManifest,
  resolved: Record<string, ResolvedValue>,
  sourceHash: string,
  lock: ImageLock,
  registry: RegistryState,
  options: PlanOptions,
): Promise<PlanItem> {
  const common = { image: manifest.name, repository: manifest.repository };
  if (options.force && !options.manualReason?.trim()) {
    throw new Error("manual force requires a reason");
  }
  const key = await eventKey(
    manifest,
    resolved,
    sourceHash,
    options.force ? options.nonce : undefined,
  );
  const tag = renderTag(manifest.tag, resolved, key);
  if (await registry.exists(manifest.repository, tag)) {
    return {
      ...common,
      action: "skip",
      reason: "published immutable event tag already exists",
      eventKey: key,
      tag,
    };
  }
  return {
    ...common,
    action: "build",
    reason: options.force ? "manual force event" : "new build event",
    eventKey: key,
    tag,
    lock,
    manualReason: options.force ? options.manualReason!.trim() : undefined,
  };
}
