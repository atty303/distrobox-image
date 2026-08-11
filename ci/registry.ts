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
