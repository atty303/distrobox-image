import { buildImage } from "./builder.ts";
import { smokeDistrobox } from "./distrobox.ts";
import { loadLock, renderLock } from "./lock.ts";
import { discoverManifests } from "./manifest.ts";
import { planImage } from "./planner.ts";
import { newestImmutableReference, SkopeoRegistry } from "./registry.ts";
import { liveResolve, productionLock, resolveManifest } from "./resolver.ts";
import type { ImageManifest } from "./types.ts";

const [command = "help", ...args] = Deno.args;
const manifests = await discoverManifests();
const select = (name?: string): ImageManifest[] =>
  !name || name === "all" ? manifests : manifests.filter((m) => m.name === name);

switch (command) {
  case "validate": {
    for (const manifest of manifests) {
      await loadLock(`${manifest.directory}/test.lock.toml`, manifest);
    }
    console.log(`validated ${manifests.length} image manifests and locks`);
    break;
  }
  case "plan": {
    const target = args.find((a) => !a.startsWith("--")) ?? Deno.env.get("IMAGE") ?? "all";
    const force = args.includes("--force") || Deno.env.get("FORCE") === "true";
    const nonce = Deno.env.get("FORCE_NONCE") ??
      `${Deno.env.get("GITHUB_RUN_ID") ?? "local"}-${Deno.env.get("GITHUB_RUN_ATTEMPT") ?? "1"}`;
    const registry = new SkopeoRegistry();
    const output = [];
    for (const manifest of select(target)) {
      const resolved = await resolveManifest(manifest);
      const source = resolved[
        manifest.triggers.find((t) => t.type === "repo-path")?.id ?? ""
      ]?.value ?? Deno.env.get("GITHUB_SHA") ?? "working-tree";
      const externalTrigger = manifest.triggers.find((item) => item.type === "oci-digest")?.id;
      const parent = manifest.parent?.external
        ? `${manifest.parent.external.split("@")[0]}@${
          externalTrigger ? resolved[externalTrigger].value : manifest.parent.external.split("@")[1]
        }`
        : (manifest.parent?.image
          ? await newestImmutableReference(
            manifests.find((item) => item.name === manifest.parent!.image)!.repository,
          )
          : (await loadLock(`${manifest.directory}/test.lock.toml`, manifest)).inputs.parent);
      const lock = productionLock(
        manifest,
        resolved,
        parent,
        new Date().toISOString().slice(0, 10).replaceAll("-", "/"),
      );
      output.push(
        await planImage(manifest, resolved, source, lock, registry, {
          now: new Date(),
          force,
          nonce,
        }),
      );
    }
    const json = JSON.stringify(output, null, 2);
    console.log(json);
    const path = Deno.env.get("PLAN_OUTPUT");
    if (path) await Deno.writeTextFile(path, json);
    break;
  }
  case "build": {
    const name = args[0];
    if (!name) throw new Error("usage: build <image> [tag] [--push]");
    const manifest = select(name)[0];
    if (!manifest) throw new Error(`unknown image ${name}`);
    const lockPath = Deno.env.get("LOCK_FILE") ?? `${manifest.directory}/test.lock.toml`;
    await buildImage(
      manifest,
      await loadLock(lockPath, manifest),
      args[1] ?? `local-${name}`,
      args.includes("--push"),
    );
    break;
  }
  case "test-images": {
    for (const manifest of select(args[0])) {
      await buildImage(
        manifest,
        await loadLock(`${manifest.directory}/test.lock.toml`, manifest),
        `test-${manifest.name}`,
      );
    }
    break;
  }
  case "test-distrobox": {
    for (const manifest of select(args[0])) {
      if (manifest.reference) {
        const image = args[1] ?? Deno.env.get("IMAGE_REF") ??
          `${manifest.repository}:test-${manifest.name}`;
        await smokeDistrobox(manifest, image);
      }
    }
    break;
  }
  case "refresh-lock": {
    const name = args[0];
    const manifest = select(name)[0];
    if (!manifest) throw new Error("usage: refresh-lock <image>");
    const resolved = await resolveManifest(manifest, liveResolve);
    const old = await loadLock(`${manifest.directory}/test.lock.toml`, manifest);
    const lock = productionLock(
      manifest,
      resolved,
      old.inputs.parent,
      new Date().toISOString().slice(0, 10).replaceAll("-", "/"),
    );
    await Deno.writeTextFile(`${manifest.directory}/test.lock.toml`, renderLock(lock));
    break;
  }
  case "refresh-fixture":
    throw new Error("fixture refresh requires a provider-specific URL; see AGENTS.md");
  default:
    console.log(
      "commands: validate, plan [image], build <image>, test-images, test-distrobox, refresh-lock",
    );
}
