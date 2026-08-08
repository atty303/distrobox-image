import type { ImageLock, ImageManifest, ResolvedValue, Trigger } from "./types.ts";
import { resolveAurVersion } from "./providers/aur_version.ts";
import { resolveGitHubRelease } from "./providers/github_release.ts";
import { resolveOciDigest } from "./providers/oci_digest.ts";
import { resolveGitCommit } from "./providers/git_commit.ts";

export type ResolveFunction = (trigger: Trigger) => Promise<ResolvedValue>;
export async function liveResolve(trigger: Trigger): Promise<ResolvedValue> {
  switch (trigger.type) {
    case "github-release": {
      const resolved = await resolveGitHubRelease(
        trigger.repository,
        trigger.channel,
        trigger.asset_pattern,
      );
      if (trigger.revision_arg && !/^[0-9a-f]{40}$/.test(resolved.revision ?? "")) {
        resolved.revision = (await resolveGitCommit(
          `https://github.com/${trigger.repository}.git`,
          `refs/tags/${resolved.metadata!.release_tag}`,
        )).value;
      }
      return resolved;
    }
    case "aur-version":
      return await resolveAurVersion(trigger.package);
    case "oci-digest":
      return await resolveOciDigest(trigger.image);
    case "git-commit":
      return await resolveGitCommit(trigger.repository, trigger.ref);
  }
}

export async function resolveManifest(
  manifest: ImageManifest,
  resolve: ResolveFunction = liveResolve,
): Promise<Record<string, ResolvedValue>> {
  return Object.fromEntries(
    await Promise.all(
      manifest.triggers.map(async (trigger) => [trigger.id, await resolve(trigger)]),
    ),
  );
}

export async function resolveSourceHash(manifest: ImageManifest): Promise<string> {
  const paths = [
    manifest.directory.replace(/^\.\//, ""),
    "ci",
    "deno.json",
    "deno.lock",
    ".mise.toml",
    "mise.lock",
  ];
  const values: string[] = [];
  for (const path of paths) {
    const result = await new Deno.Command("git", {
      args: ["rev-parse", `HEAD:${path}`],
      stdout: "piped",
      stderr: "piped",
    }).output();
    if (!result.success) throw new Error(`cannot hash source path ${path}`);
    values.push(`${path}:${new TextDecoder().decode(result.stdout).trim()}`);
  }
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(values.join("\n")));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function productionLock(
  manifest: ImageManifest,
  resolved: Record<string, ResolvedValue>,
  parent: string,
  archSnapshot: string,
): ImageLock {
  const inputs: Record<string, string> = { parent, arch_snapshot: archSnapshot };
  const build_args: Record<string, string> = { BASE_IMAGE: parent, ARCH_SNAPSHOT: archSnapshot };
  const expected: Record<string, string> = {};
  for (const trigger of manifest.triggers) {
    const result = resolved[trigger.id];
    if (!result) throw new Error(`${manifest.name}: unresolved trigger ${trigger.id}`);
    const id = trigger.id.replaceAll("-", "_");
    switch (trigger.type) {
      case "github-release":
        inputs[`${id}_version`] = result.value;
        if (trigger.revision_arg) {
          if (!result.revision) throw new Error(`${manifest.name}: ${trigger.id} has no revision`);
          inputs[`${id}_commit`] = result.revision;
          build_args[trigger.revision_arg] = result.revision;
        }
        if (trigger.asset_pattern) {
          if (!result.metadata?.asset_url || !result.metadata.asset_sha256) {
            throw new Error(`${manifest.name}: ${trigger.id} asset is incomplete`);
          }
          inputs[`${id}_url`] = result.metadata.asset_url;
          inputs[`${id}_sha256`] = result.metadata.asset_sha256;
          build_args[trigger.url_arg!] = result.metadata.asset_url;
          build_args[trigger.checksum_arg!] = result.metadata.asset_sha256;
        }
        break;
      case "aur-version":
        if (!result.revision) throw new Error(`${manifest.name}: ${trigger.id} has no AUR commit`);
        inputs[`${id}_version`] = result.value;
        inputs[`${id}_commit`] = result.revision;
        if (trigger.revision_arg) build_args[trigger.revision_arg] = result.revision;
        break;
      case "oci-digest":
        inputs[`${id}_digest`] = result.value;
        break;
      case "git-commit":
        inputs[`${id}_commit`] = result.value;
        break;
    }
    if (trigger.build_arg) build_args[trigger.build_arg] = result.value;
    if (trigger.label) {
      const value = trigger.label_source === "revision" ? result.revision : result.value;
      if (!value) throw new Error(`${manifest.name}: ${trigger.id} label value is missing`);
      expected[trigger.label] = value;
    }
  }
  return { schema: 2, image: manifest.name, inputs, build_args, expected };
}
