import { assertEquals, assertRejects } from "@std/assert";
import { discoverManifests, loadManifest } from "../manifest.ts";
import { loadLock } from "../lock.ts";

Deno.test("repository manifests and locks validate", async () => {
  const manifests = await discoverManifests();
  assertEquals(manifests.length, 3);
  for (const manifest of manifests) {
    await loadLock(`${manifest.directory}/test.lock.toml`, manifest);
  }
});
Deno.test("unknown manifest fields are rejected", async () => {
  const path = await Deno.makeTempFile();
  await Deno.writeTextFile(
    path,
    'schema=1\nname="x"\nrepository="ghcr.io/a/x"\ncontext="."\ncontainerfile="Containerfile"\ntag="x"\nunknown=true\n',
  );
  await assertRejects(() => loadManifest(path), Error, "unknown field");
  await Deno.remove(path);
});
