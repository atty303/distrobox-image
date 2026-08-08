import type { ResolvedValue } from "../types.ts";

export interface GitHubRelease {
  tag_name: string;
  prerelease: boolean;
  draft: boolean;
  target_commitish?: string;
  assets?: Array<{ name: string; browser_download_url: string; digest?: string }>;
}
export function selectRelease(
  payload: unknown,
  channel: "stable" | "prerelease" = "stable",
): ResolvedValue {
  if (!Array.isArray(payload)) throw new Error("GitHub release response is not an array");
  const releases = payload as GitHubRelease[];
  const release = releases.find((r) =>
    !r.draft && (channel === "prerelease" || !r.prerelease) && typeof r.tag_name === "string"
  );
  if (!release) throw new Error("no matching GitHub release");
  return {
    value: release.tag_name.replace(/^v/, ""),
    revision: release.target_commitish,
    metadata: { release_tag: release.tag_name },
  };
}
export async function resolveGitHubRelease(
  repository: string,
  channel: "stable" | "prerelease" = "stable",
  assetPattern?: string,
  fetcher = fetch,
): Promise<ResolvedValue> {
  const response = await fetcher(
    `https://api.github.com/repos/${repository}/releases?per_page=20`,
    {
      headers: { accept: "application/vnd.github+json", "user-agent": "distrobox-image-resolver" },
    },
  );
  if (!response.ok) throw new Error(`GitHub ${repository}: HTTP ${response.status}`);
  const payload = await response.json();
  const selected = selectRelease(payload, channel);
  if (assetPattern) {
    const release = (payload as GitHubRelease[]).find((item) =>
      item.tag_name.replace(/^v/, "") === selected.value
    )!;
    const name = assetPattern.replace("{version}", selected.value);
    const asset = release.assets?.find((item) => item.name === name);
    if (!asset?.browser_download_url || !asset.digest?.startsWith("sha256:")) {
      throw new Error(`release ${repository}@${selected.value} lacks checksummed asset ${name}`);
    }
    selected.metadata = {
      ...selected.metadata,
      asset_url: asset.browser_download_url,
      asset_sha256: asset.digest.slice(7),
    };
  }
  return selected;
}
