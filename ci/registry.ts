import { tagPattern } from "./planner.ts";
import type { ImageManifest, RegistryState } from "./types.ts";

export class SkopeoRegistry implements RegistryState {
  async exists(repository: string, tag: string): Promise<boolean> {
    const result = await new Deno.Command("skopeo", {
      args: ["inspect", `docker://${repository}:${tag}`],
      stdout: "null",
      stderr: "null",
    }).output();
    return result.success;
  }
}

export async function newestPublishedReference(manifest: ImageManifest): Promise<string> {
  const tagsResult = await new Deno.Command("skopeo", {
    args: ["list-tags", `docker://${manifest.repository}`],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!tagsResult.success) throw new Error(`cannot list parent tags for ${manifest.repository}`);
  const pattern = tagPattern(manifest.tag);
  const tags = (JSON.parse(new TextDecoder().decode(tagsResult.stdout)).Tags as string[]).filter((
    tag,
  ) => pattern.test(tag));
  const candidates = await Promise.all(tags.map(async (tag) => {
    const result = await new Deno.Command("skopeo", {
      args: ["inspect", `docker://${manifest.repository}:${tag}`],
      stdout: "piped",
      stderr: "null",
    }).output();
    if (!result.success) return undefined;
    const data = JSON.parse(new TextDecoder().decode(result.stdout));
    return { digest: data.Digest as string, created: Date.parse(data.Created ?? 0) };
  }));
  const latest =
    candidates.filter((item) => item?.digest).sort((a, b) => b!.created - a!.created)[0];
  if (!latest) {
    throw new Error(`no published immutable parent tag found for ${manifest.repository}`);
  }
  return `${manifest.repository}@${latest.digest}`;
}

export async function publishedDigest(repository: string, tag: string): Promise<string> {
  const result = await new Deno.Command("skopeo", {
    args: ["inspect", "--format", "{{.Digest}}", `docker://${repository}:${tag}`],
    stdout: "piped",
    stderr: "piped",
  }).output();
  const digest = new TextDecoder().decode(result.stdout).trim();
  if (!result.success || !/^sha256:[0-9a-f]{64}$/.test(digest)) {
    throw new Error(`cannot resolve published digest for ${repository}:${tag}`);
  }
  return `${repository}@${digest}`;
}

export class MemoryRegistry implements RegistryState {
  constructor(private tags = new Set<string>()) {}
  exists(repository: string, tag: string) {
    return Promise.resolve(this.tags.has(`${repository}:${tag}`));
  }
}
