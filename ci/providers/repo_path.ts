import type { ResolvedValue } from "../types.ts";
export async function resolveRepoPath(paths: string[], cwd = "."): Promise<ResolvedValue> {
  const command = new Deno.Command("git", {
    args: ["rev-parse", `HEAD:${paths[0]}`],
    cwd,
    stdout: "piped",
    stderr: "piped",
  });
  const result = await command.output();
  if (!result.success) throw new Error(new TextDecoder().decode(result.stderr));
  return { value: new TextDecoder().decode(result.stdout).trim() };
}
