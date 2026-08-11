import { assertEquals } from "@std/assert";
import { affectedImages } from "../affected.ts";
import { discoverManifests } from "../manifest.ts";

Deno.test("image-local changes stay local while common changes select all images", async () => {
  const manifests = await discoverManifests();
  assertEquals(
    affectedImages(manifests, ["arch-scroll/distrobox.ini"]).map((item) => item.name),
    ["arch-scroll"],
  );
  assertEquals(
    affectedImages(manifests, ["arch-toolbox-paru/distrobox.ini"]).map((item) => item.name),
    ["arch-toolbox-paru"],
  );
  assertEquals(
    affectedImages(manifests, ["common/arch/provision.sh"]).map((item) => item.name),
    manifests.map((item) => item.name),
  );
});
