import type { RegistryState } from "./types.ts";
export class SkopeoRegistry implements RegistryState {
  async exists(repository: string, tag: string): Promise<boolean> {
    const result = await new Deno.Command("skopeo", {
      args: ["inspect", `docker://${repository}:${tag}`],
      stdout: "null",
      stderr: "null",
    }).output();
    return result.success;
  }
  async verified(repository: string, tag: string): Promise<boolean> {
    const result = await new Deno.Command("skopeo", {
      args: ["inspect", "--config", `docker://${repository}:${tag}`],
      stdout: "piped",
      stderr: "null",
    }).output();
    if (!result.success) return false;
    const config = JSON.parse(new TextDecoder().decode(result.stdout));
    return config?.config?.Labels?.["io.atty303.distrobox.verified"] === "true";
  }
}
export async function newestImmutableReference(repository: string): Promise<string> {
  const tagsResult = await new Deno.Command("skopeo", {
    args: ["list-tags", `docker://${repository}`],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!tagsResult.success) throw new Error(`cannot list parent tags for ${repository}`);
  const tags = (JSON.parse(new TextDecoder().decode(tagsResult.stdout)).Tags as string[]).filter((
    tag,
  ) => !["latest", "stable", "candidate"].includes(tag));
  const candidates = await Promise.all(tags.map(async (tag) => {
    const result = await new Deno.Command("skopeo", {
      args: ["inspect", `docker://${repository}:${tag}`],
      stdout: "piped",
      stderr: "null",
    }).output();
    if (!result.success) return undefined;
    const data = JSON.parse(new TextDecoder().decode(result.stdout));
    return { tag, digest: data.Digest as string, created: Date.parse(data.Created ?? 0) };
  }));
  const latest =
    candidates.filter((item) => item?.digest).sort((a, b) => b!.created - a!.created)[0];
  if (!latest) throw new Error(`no immutable parent tag found for ${repository}`);
  return `${repository}@${latest.digest}`;
}
export class MemoryRegistry implements RegistryState {
  constructor(private tags = new Map<string, boolean>()) {}
  exists(repository: string, tag: string) {
    return Promise.resolve(this.tags.has(`${repository}:${tag}`));
  }
  verified(repository: string, tag: string) {
    return Promise.resolve(this.tags.get(`${repository}:${tag}`) === true);
  }
}
