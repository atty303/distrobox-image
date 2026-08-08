import type { ImageLock, ImageManifest, ResolvedValue, Trigger } from "./types.ts";
import { resolveAurVersion } from "./providers/aur_version.ts";
import { resolveGitHubRelease } from "./providers/github_release.ts";
import { resolveOciDigest } from "./providers/oci_digest.ts";
import { resolveRepoPath } from "./providers/repo_path.ts";
import { resolveManual } from "./providers/manual.ts";
import { resolveGitCommit } from "./providers/git_commit.ts";

export type ResolveFunction = (trigger: Trigger) => Promise<ResolvedValue>;
export async function liveResolve(trigger: Trigger): Promise<ResolvedValue> {
  switch (trigger.type) {
    case "github-release": {
      const resolved = await resolveGitHubRelease(
        trigger.repository!,
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
      return await resolveAurVersion(trigger.package!);
    case "oci-digest":
      return await resolveOciDigest(trigger.image!);
    case "repo-path":
      return await resolveRepoPath(trigger.paths ?? []);
    case "git-commit":
      return await resolveGitCommit(trigger.repository!, trigger.ref);
    case "manual":
      return resolveManual(Deno.env.get("FORCE_NONCE") ?? "");
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
export function productionLock(
  manifest: ImageManifest,
  resolved: Record<string, ResolvedValue>,
  parent: string,
  archSnapshot: string,
): ImageLock {
  const inputs: Record<string, string> = { parent, arch_snapshot: archSnapshot };
  const build_args: Record<string, string> = { BASE_IMAGE: parent, ARCH_SNAPSHOT: archSnapshot };
  for (const trigger of manifest.triggers) {
    const value = resolved[trigger.id];
    const prefix = trigger.id.replaceAll("-", "_");
    const revisionPrefix = trigger.lock_prefix ?? prefix;
    inputs[`${prefix}_version`] = value.value;
    if (value.revision) inputs[`${revisionPrefix}_commit`] = value.revision;
    if (trigger.build_arg) build_args[trigger.build_arg] = value.value;
    if (value.revision && trigger.revision_arg) {
      build_args[trigger.revision_arg] = value.revision;
    }
    if (value.metadata?.asset_url && trigger.url_arg) {
      inputs[`${prefix}_url`] = value.metadata.asset_url;
      build_args[trigger.url_arg] = value.metadata.asset_url;
    }
    if (value.metadata?.asset_sha256 && trigger.checksum_arg) {
      inputs[`${prefix}_sha256`] = value.metadata.asset_sha256;
      build_args[trigger.checksum_arg] = value.metadata.asset_sha256;
    }
  }
  return {
    schema: 1,
    image: manifest.name,
    inputs,
    build_args,
    expected: Object.fromEntries(
      manifest.triggers.filter((t) => t.role === "build").map((
        t,
      ) => [`${t.id}_version`, resolved[t.id].value]),
    ),
  };
}
