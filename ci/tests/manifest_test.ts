import { assertEquals, assertRejects } from "@std/assert";
import { discoverManifests, loadManifest } from "../manifest.ts";
import { loadLock } from "../lock.ts";

Deno.test("repository manifests and locks validate", async () => {
  const manifests = await discoverManifests();
  assertEquals(manifests.length, 4);
  assertEquals(manifests.map((manifest) => manifest.name), [
    "arch-toolbox-paru",
    "arch-dms",
    "arch-noctalia",
    "arch-scroll",
  ]);
  for (const manifest of manifests) {
    await loadLock(`${manifest.directory}/test.lock.toml`, manifest);
  }
});
Deno.test("unknown manifest fields are rejected", async () => {
  const path = await Deno.makeTempFile();
  await Deno.writeTextFile(
    path,
    'schema=2\nname="x"\nrepository="ghcr.io/a/x"\ncontext="."\ncontainerfile="Containerfile"\ntag="x-{event_hash8}"\nunknown=true\n',
  );
  await assertRejects(() => loadManifest(path), Error, "unknown field");
  await Deno.remove(path);
});
Deno.test("reference file paths are fixed by convention", async () => {
  const path = await Deno.makeTempFile();
  await Deno.writeTextFile(
    path,
    'schema=2\nname="x"\nrepository="ghcr.io/a/x"\ncontext="."\ncontainerfile="Containerfile"\ntag="x-{event_hash8}"\n[[triggers]]\nid="source"\ntype="git-commit"\nrole="build"\nrepository="https://example.com/x.git"\n[reference]\nfile="somewhere.ini"\nsection="x"\n[[smoke]]\ncommand=["true"]\n',
  );
  await assertRejects(() => loadManifest(path), Error, "reference has unknown field(s): file");
  await Deno.remove(path);
});
