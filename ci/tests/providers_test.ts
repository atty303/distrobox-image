import { assertEquals, assertThrows } from "@std/assert";
import { parseAur } from "../providers/aur_version.ts";
import { selectRelease } from "../providers/github_release.ts";
import { parseDigest } from "../providers/oci_digest.ts";
Deno.test("GitHub provider ignores draft and prerelease", () =>
  assertEquals(
    selectRelease([{ tag_name: "v2", prerelease: true, draft: false }, {
      tag_name: "v1",
      prerelease: false,
      draft: false,
    }]).value,
    "1",
  ));
Deno.test("AUR provider normalizes epoch and subrelease pkgrel", () =>
  assertEquals(
    parseAur({ resultcount: 1, results: [{ Name: "pkg", Version: "1:2.3-4.1" }] }, "pkg").value,
    "2.3",
  ));
Deno.test("OCI provider requires sha256", () => {
  assertThrows(() => parseDigest("latest"));
});
