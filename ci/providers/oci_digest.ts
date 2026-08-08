import type { ResolvedValue } from "../types.ts";
export function parseDigest(output: string): ResolvedValue {
  const digest = output.trim();
  if (!/^sha256:[0-9a-f]{64}$/.test(digest)) throw new Error(`invalid OCI digest: ${digest}`);
  return { value: digest };
}
export async function resolveOciDigest(image: string): Promise<ResolvedValue> {
  const command = new Deno.Command("skopeo", {
    args: ["inspect", "--format", "{{.Digest}}", `docker://${image}`],
    stdout: "piped",
    stderr: "piped",
  });
  const result = await command.output();
  if (!result.success) throw new Error(new TextDecoder().decode(result.stderr));
  return parseDigest(new TextDecoder().decode(result.stdout));
}
