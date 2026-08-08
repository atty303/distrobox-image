import { assertEquals, assertStringIncludes } from "@std/assert";
import { adaptIniForPodman, materializeIni } from "../distrobox.ts";
import { discoverManifests, referencePath } from "../manifest.ts";
Deno.test("INI materialization preserves repeated keys and rewrites includes", async () => {
  const manifest = (await discoverManifests()).find((m) => m.name === "arch-scroll")!;
  const input = await Deno.readTextFile(referencePath(manifest));
  const output = materializeIni(input, manifest, {
    name: "run-scroll",
    image: "localhost/scroll:test",
    home: "/tmp/home",
    fixtureRoot: "/tmp/fixtures",
  });
  assertStringIncludes(output, "[run-scroll]");
  assertStringIncludes(output, "include=run-scroll");
  assertStringIncludes(output, "image=localhost/scroll:test");
  assertStringIncludes(output, "pull=false");
  assertEquals(output.match(/^init_hooks=/gm)?.length, 2);
  assertEquals(output.match(/^volume=/gm)?.length, 2);
});

Deno.test("Podman compatibility retains local flags on current Podman", () => {
  const input = 'additional_flags="--userns keep-id:size=65534"';
  assertEquals(adaptIniForPodman(input, "podman version 5.8.2"), input);
});

Deno.test("Podman compatibility limits only unsupported keep-id size", () => {
  const input =
    'additional_flags="--userns keep-id:size=65534 --annotation run.oci.keep_original_groups=0"';
  assertEquals(
    adaptIniForPodman(input, "podman version 4.9.3"),
    'additional_flags="--userns keep-id --annotation run.oci.keep_original_groups=0"',
  );
});
