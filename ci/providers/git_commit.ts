import type { ResolvedValue } from "../types.ts";
export async function resolveGitCommit(repository: string, ref = "HEAD"): Promise<ResolvedValue> {
  const result = await new Deno.Command("git", {
    args: ["ls-remote", repository, ref],
    stdout: "piped",
    stderr: "piped",
  }).output();
  const commit = new TextDecoder().decode(result.stdout).trim().split(/\s+/)[0];
  if (!result.success || !/^[0-9a-f]{40}$/.test(commit)) {
    throw new Error(`cannot resolve ${repository} ${ref}`);
  }
  return { value: commit };
}
