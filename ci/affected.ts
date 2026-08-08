import type { ImageManifest } from "./types.ts";

function descendants(manifests: ImageManifest[], names: Set<string>): Set<string> {
  let changed = true;
  while (changed) {
    changed = false;
    for (const manifest of manifests) {
      if (manifest.parent?.image && names.has(manifest.parent.image) && !names.has(manifest.name)) {
        names.add(manifest.name);
        changed = true;
      }
    }
  }
  return names;
}

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
  return all
    ? manifests
    : manifests.filter((manifest) => descendants(manifests, names).has(manifest.name));
}
