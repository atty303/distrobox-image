import type { ResolvedValue } from "../types.ts";
export interface AurInfo {
  resultcount: number;
  results: Array<{ Name: string; Version: string; LastModified?: number }>;
}
export function parseAur(payload: unknown, packageName: string): ResolvedValue {
  const data = payload as Partial<AurInfo>;
  if (!Array.isArray(data.results)) throw new Error("AUR response has no results array");
  const item = data.results.find((result) => result.Name === packageName);
  if (!item?.Version) throw new Error(`AUR package not found: ${packageName}`);
  const value = item.Version.replace(/^\d+:/, "").replace(/-\d+(?:\.\d+)?$/, "");
  return {
    value,
    revision: item.LastModified?.toString(),
    metadata: { package_version: item.Version },
  };
}
export async function resolveAurVersion(
  packageName: string,
  fetcher = fetch,
): Promise<ResolvedValue> {
  const response = await fetcher(
    `https://aur.archlinux.org/rpc/v5/info?arg[]=${encodeURIComponent(packageName)}`,
  );
  if (!response.ok) throw new Error(`AUR ${packageName}: HTTP ${response.status}`);
  const resolved = parseAur(await response.json(), packageName);
  const result = await new Deno.Command("git", {
    args: ["ls-remote", `https://aur.archlinux.org/${packageName}.git`, "HEAD"],
    stdout: "piped",
    stderr: "piped",
  }).output();
  const commit = new TextDecoder().decode(result.stdout).trim().split(/\s+/)[0];
  if (!result.success || !/^[0-9a-f]{40}$/.test(commit)) {
    throw new Error(`cannot resolve AUR commit for ${packageName}`);
  }
  resolved.revision = commit;
  return resolved;
}
