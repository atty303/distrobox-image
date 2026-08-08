import type { ImageLock, ImageManifest, PlanItem, RegistryState, ResolvedValue } from "./types.ts";

export interface PlanOptions {
  now: Date;
  force?: boolean;
  nonce?: string;
  previous?: Record<string, string>;
  changedPaths?: string[];
}
async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function jstYearMonth(now: Date): { year: string; month: string; key: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const year = parts.find((part) => part.type === "year")!.value;
  const month = parts.find((part) => part.type === "month")!.value;
  return { year, month, key: `${year}-${month}` };
}
export async function eventKey(
  manifest: ImageManifest,
  resolved: Record<string, ResolvedValue>,
  sourceHash: string,
  now: Date,
  nonce?: string,
): Promise<string> {
  const month = jstYearMonth(now).key;
  const build = manifest.triggers.filter((t) => t.role === "build").map((
    t,
  ) => [t.id, t.monthly ? month : resolved[t.id]?.value]).sort(([a], [b]) => a!.localeCompare(b!));
  return await sha256(
    JSON.stringify({
      schema: manifest.schema,
      image: manifest.name,
      build,
      sourceHash,
      nonce: nonce || undefined,
    }),
  );
}
export function renderTag(
  template: string,
  resolved: Record<string, ResolvedValue>,
  hash: string,
  now: Date,
): string {
  const jst = jstYearMonth(now);
  const values: Record<string, string> = {
    event_hash8: hash.slice(0, 8),
    year: jst.year,
    month: jst.month,
  };
  for (const [id, result] of Object.entries(resolved)) {
    values[`${id}.version`] = result.value.replace(/^v/, "").replace(/[^A-Za-z0-9_.-]/g, "-");
  }
  const tag = template.replace(/\{([^}]+)\}/g, (_, key) =>
    values[key] ?? (() => {
      throw new Error(`undefined tag variable ${key}`);
    })());
  if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(tag)) throw new Error(`invalid OCI tag ${tag}`);
  return tag;
}
function gatesPass(manifest: ImageManifest, resolved: Record<string, ResolvedValue>): boolean {
  return manifest.triggers.filter((t) => t.role === "gate" && t.matches).every((gate) =>
    resolved[gate.id]?.value === resolved[gate.matches!]?.value
  );
}
export async function planImage(
  manifest: ImageManifest,
  resolved: Record<string, ResolvedValue>,
  sourceHash: string,
  lock: ImageLock,
  registry: RegistryState,
  options: PlanOptions,
): Promise<PlanItem> {
  if (!gatesPass(manifest, resolved)) {
    return { image: manifest.name, action: "wait", reason: "gate trigger has not caught up" };
  }
  const key = await eventKey(
    manifest,
    resolved,
    sourceHash,
    options.now,
    options.force ? options.nonce : undefined,
  );
  const tag = renderTag(manifest.tag, resolved, key, options.now);
  if (await registry.exists(manifest.repository, tag)) {
    return await registry.verified(manifest.repository, tag)
      ? {
        image: manifest.name,
        action: "skip",
        reason: "immutable event tag is already verified",
        eventKey: key,
        tag,
      }
      : {
        image: manifest.name,
        action: "verify",
        reason: "tag exists but verification is incomplete",
        eventKey: key,
        tag,
      };
  }
  const buildValues = Object.fromEntries(
    manifest.triggers.filter((t) => t.role === "build").map((t) => [t.id, resolved[t.id].value]),
  );
  const unchanged = !options.force && options.previous &&
    Object.entries(buildValues).every(([k, v]) => options.previous![`${manifest.name}.${k}`] === v);
  if (unchanged) {
    return {
      image: manifest.name,
      action: "skip",
      reason: "build triggers are unchanged",
      eventKey: key,
      tag,
    };
  }
  return {
    image: manifest.name,
    action: "build",
    reason: options.force ? "manual force event" : "new build event",
    eventKey: key,
    tag,
    lock,
  };
}
