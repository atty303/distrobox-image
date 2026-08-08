import { assertEquals, assertStringIncludes } from "@std/assert";
import { materializeIni } from "../distrobox.ts";
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
