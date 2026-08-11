import type { ImageManifest } from "./types.ts";

export function affectedImages(manifests: ImageManifest[], paths: string[]): ImageManifest[] {
  const names = new Set<string>();
  let all = false;
  for (const path of paths) {
    const direct = manifests.find((manifest) =>
      path.startsWith(`${manifest.directory.replace(/^\.\//, "")}/`)
    );
    if (direct) {
      names.add(direct.name);
      continue;
    }
    if (/^(README\.md|AGENTS\.md)$/.test(path)) continue;
    all = true;
  }
  return all ? manifests : manifests.filter((manifest) => names.has(manifest.name));
}
