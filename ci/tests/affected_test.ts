import { assertEquals } from "@std/assert";
import { affectedImages } from "../affected.ts";
import { discoverManifests } from "../manifest.ts";

Deno.test("image-local Distrobox changes select the image and descendants", async () => {
  const manifests = await discoverManifests();
  assertEquals(
    affectedImages(manifests, ["arch-scroll/distrobox.ini"]).map((item) => item.name),
    ["arch-scroll"],
  );
  assertEquals(
    affectedImages(manifests, ["arch-toolbox-paru/distrobox.ini"]).map((item) => item.name),
    ["arch-toolbox-paru", "arch-dms", "arch-scroll"],
  );
});
