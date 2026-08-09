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
Deno.test("removed gate fields are rejected", async () => {
  const gatePath = await Deno.makeTempFile();
  const matchesPath = await Deno.makeTempFile();
  try {
    await Deno.writeTextFile(
      gatePath,
      'schema=2\nname="x"\nrepository="ghcr.io/a/x"\ncontext="."\ncontainerfile="Containerfile"\ntag="x-{event_hash8}"\n[[triggers]]\nid="aur"\ntype="aur-version"\nrole="gate"\npackage="x"\n[[smoke]]\ncommand=["true"]\n',
    );
    await Deno.writeTextFile(
      matchesPath,
      'schema=2\nname="x"\nrepository="ghcr.io/a/x"\ncontext="."\ncontainerfile="Containerfile"\ntag="x-{event_hash8}"\n[[triggers]]\nid="aur"\ntype="aur-version"\nrole="input"\npackage="x"\nmatches="source"\n[[smoke]]\ncommand=["true"]\n',
    );
    await assertRejects(() => loadManifest(gatePath), Error, "unknown trigger role gate");
    await assertRejects(() => loadManifest(matchesPath), Error, "unknown field(s): matches");
  } finally {
    await Deno.remove(gatePath);
    await Deno.remove(matchesPath);
  }
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
