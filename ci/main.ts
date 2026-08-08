import { buildImage, imageReference, pushImage, smokeImage } from "./builder.ts";
import { affectedImages } from "./affected.ts";
import { smokeDistrobox } from "./distrobox.ts";
import { canonicalLock, loadLock, renderLock } from "./lock.ts";
import { discoverManifests } from "./manifest.ts";
import { planImage } from "./planner.ts";
import { newestPublishedReference, publishedDigest, SkopeoRegistry } from "./registry.ts";
import { liveResolve, productionLock, resolveManifest, resolveSourceHash } from "./resolver.ts";
import type { ImageLock, ImageManifest, PlanItem } from "./types.ts";

const [command = "help", ...args] = Deno.args;
const manifests = await discoverManifests();
const byName = new Map(manifests.map((manifest) => [manifest.name, manifest]));

function select(names: string[]): ImageManifest[] {
  if (!names.length || names.includes("all")) return manifests;
  const requested = new Set(names);
  for (const name of requested) if (!byName.has(name)) throw new Error(`unknown image ${name}`);
  return manifests.filter((manifest) => requested.has(manifest.name));
}
function jstDate(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)!.value;
  return `${value("year")}/${value("month")}/${value("day")}`;
}
function withParent(lock: ImageLock, parent: string): ImageLock {
  return {
    ...lock,
    inputs: { ...lock.inputs, parent },
    build_args: { ...lock.build_args, BASE_IMAGE: parent },
  };
}
async function assertResolutionUnchanged(
  manifest: ImageManifest,
  lock: ImageLock,
): Promise<void> {
  const current = productionLock(
    manifest,
    await resolveManifest(manifest),
    lock.inputs.parent,
    lock.inputs.arch_snapshot,
  );
  if (canonicalLock(current) !== canonicalLock(lock)) {
    throw new Error(`${manifest.name}: upstream inputs changed during build; refusing to publish`);
  }
}
async function resolvedParent(
  manifest: ImageManifest,
  resolved: Awaited<ReturnType<typeof resolveManifest>>,
): Promise<string> {
  if (manifest.parent?.external) {
    const trigger = manifest.triggers.find((item) => item.type === "oci-digest");
    return trigger
      ? `${manifest.parent.external.split("@")[0]}@${resolved[trigger.id].value}`
      : manifest.parent.external;
  }
  if (manifest.parent?.image) {
    try {
      return await newestPublishedReference(byName.get(manifest.parent.image)!);
    } catch (error) {
      if (!(error instanceof Error) || !error.message.startsWith("no published immutable parent")) {
        throw error;
      }
      return (await loadLock(`${manifest.directory}/test.lock.toml`, manifest)).inputs.parent;
    }
  }
  return (await loadLock(`${manifest.directory}/test.lock.toml`, manifest)).inputs.parent;
}
async function runIntegration(selected: ImageManifest[], distrobox: boolean) {
  const localParents = new Map<string, string>();
  for (const manifest of selected) {
    let lock = await loadLock(`${manifest.directory}/test.lock.toml`, manifest);
    if (manifest.parent?.image && localParents.has(manifest.parent.image)) {
      lock = withParent(lock, localParents.get(manifest.parent.image)!);
    }
    const tag = `test-${manifest.name}`;
    const image = await buildImage(manifest, lock, tag);
    await smokeImage(manifest, lock, image);
    if (distrobox && manifest.reference) await smokeDistrobox(manifest, lock, image);
    localParents.set(manifest.name, image);
  }
}
async function affected(base: string, head: string): Promise<ImageManifest[]> {
  const result = await new Deno.Command("git", {
    args: ["diff", "--name-only", base, head],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!result.success) return manifests;
  const paths = new TextDecoder().decode(result.stdout).trim().split("\n").filter(Boolean);
  return affectedImages(manifests, paths);
}

switch (command) {
  case "validate": {
    for (const manifest of manifests) {
      await loadLock(`${manifest.directory}/test.lock.toml`, manifest);
    }
    console.log(`validated ${manifests.length} image manifests and locks`);
    break;
  }
  case "affected": {
    if (args.length !== 2) throw new Error("usage: affected <base> <head>");
    console.log(
      JSON.stringify((await affected(args[0], args[1])).map((manifest) => manifest.name)),
    );
    break;
  }
  case "plan": {
    const target = args.find((arg) => !arg.startsWith("--")) ?? Deno.env.get("IMAGE") ?? "all";
    const force = args.includes("--force") || Deno.env.get("FORCE") === "true";
    const manualReason = Deno.env.get("FORCE_REASON") ?? "";
    const nonce = Deno.env.get("FORCE_NONCE") ??
      `${Deno.env.get("GITHUB_RUN_ID") ?? "local"}-${Deno.env.get("GITHUB_RUN_ATTEMPT") ?? "1"}`;
    const now = new Date();
    const registry = new SkopeoRegistry();
    const output: PlanItem[] = [];
    for (const manifest of select([target])) {
      const resolved = await resolveManifest(manifest);
      const lock = productionLock(
        manifest,
        resolved,
        await resolvedParent(manifest, resolved),
        jstDate(now),
      );
      output.push(
        await planImage(
          manifest,
          resolved,
          await resolveSourceHash(manifest),
          lock,
          registry,
          { now, force, nonce, manualReason },
        ),
      );
    }
    const json = JSON.stringify(output, null, 2);
    console.log(json);
    if (Deno.env.get("PLAN_OUTPUT")) await Deno.writeTextFile(Deno.env.get("PLAN_OUTPUT")!, json);
    break;
  }
  case "publish": {
    const path = args[0];
    if (!path) throw new Error("usage: publish <plan.json>");
    const plan = JSON.parse(await Deno.readTextFile(path)) as PlanItem[];
    const items = new Map(
      plan.filter((item) => item.action === "build").map((item) => [item.image, item]),
    );
    const publishedParents = new Map<string, string>();
    const registry = new SkopeoRegistry();
    const lockDirectory = Deno.env.get("LOCK_OUTPUT_DIR") ?? "production-locks";
    const resultPath = Deno.env.get("RESULT_OUTPUT") ?? "publish-result.json";
    await Deno.mkdir(lockDirectory, { recursive: true });
    const results: Array<Record<string, string>> = [];
    try {
      for (const manifest of manifests) {
        const item = items.get(manifest.name);
        if (!item?.tag || !item.lock) continue;
        let lock = item.lock;
        if (manifest.parent?.image && publishedParents.has(manifest.parent.image)) {
          lock = withParent(lock, publishedParents.get(manifest.parent.image)!);
        }
        await Deno.writeTextFile(`${lockDirectory}/${manifest.name}.lock.toml`, renderLock(lock));
        const image = await buildImage(manifest, lock, item.tag);
        await smokeImage(manifest, lock, image);
        if (manifest.reference) await smokeDistrobox(manifest, lock, image);
        await assertResolutionUnchanged(manifest, lock);
        if (await registry.exists(manifest.repository, item.tag)) {
          throw new Error(`refusing to overwrite ${manifest.repository}:${item.tag}`);
        }
        await pushImage(image);
        const reference = await publishedDigest(manifest.repository, item.tag);
        publishedParents.set(manifest.name, reference);
        results.push({
          image: manifest.name,
          repository: manifest.repository,
          tag: item.tag,
          reference,
        });
        await Deno.writeTextFile(resultPath, JSON.stringify(results, null, 2));
      }
    } finally {
      await Deno.writeTextFile(resultPath, JSON.stringify(results, null, 2));
    }
    break;
  }
  case "build": {
    const manifest = select([args[0]])[0];
    const lock = await loadLock(
      Deno.env.get("LOCK_FILE") ?? `${manifest.directory}/test.lock.toml`,
      manifest,
    );
    const image = await buildImage(manifest, lock, args[1] ?? `local-${manifest.name}`);
    await smokeImage(manifest, lock, image);
    if (manifest.reference) await smokeDistrobox(manifest, lock, image);
    break;
  }
  case "test-images":
    await runIntegration(select(args), false);
    break;
  case "test-integration":
    await runIntegration(select(args), true);
    break;
  case "test-changed": {
    if (args.length !== 2) throw new Error("usage: test-changed <base> <head>");
    await runIntegration(await affected(args[0], args[1]), true);
    break;
  }
  case "test-distrobox": {
    for (const manifest of select(args.slice(0, 1))) {
      if (!manifest.reference) continue;
      const lock = await loadLock(`${manifest.directory}/test.lock.toml`, manifest);
      await smokeDistrobox(
        manifest,
        lock,
        args[1] ?? Deno.env.get("IMAGE_REF") ?? imageReference(manifest, `test-${manifest.name}`),
      );
    }
    break;
  }
  case "refresh-lock": {
    const manifest = select([args[0]])[0];
    const resolved = await resolveManifest(manifest, liveResolve);
    const lock = productionLock(
      manifest,
      resolved,
      await resolvedParent(manifest, resolved),
      jstDate(new Date()),
    );
    const rendered = renderLock(lock);
    const temporary = await Deno.makeTempFile();
    try {
      await Deno.writeTextFile(temporary, rendered);
      await loadLock(temporary, manifest);
      await Deno.writeTextFile(`${manifest.directory}/test.lock.toml`, rendered);
    } finally {
      await Deno.remove(temporary);
    }
    break;
  }
  default:
    console.log(
      "commands: validate, affected, plan, publish, build, test-images, test-integration, test-changed, test-distrobox, refresh-lock",
    );
}
