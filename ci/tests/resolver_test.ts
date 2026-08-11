import { assertEquals, assertNotEquals } from "@std/assert";
import { discoverManifests } from "../manifest.ts";
import { sourceHashFromEntries } from "../resolver.ts";

Deno.test("event source hash excludes reference INI and test lock", async () => {
  const manifest = (await discoverManifests()).find((item) => item.name === "arch-scroll")!;
  const entries = [
    `${"1".repeat(40)}:arch-scroll/Containerfile`,
    `${"2".repeat(40)}:arch-scroll/image.toml`,
    `${"3".repeat(40)}:arch-scroll/distrobox.ini`,
    `${"4".repeat(40)}:arch-scroll/test.lock.toml`,
    `${"5".repeat(40)}:ci/main.ts`,
    `${"6".repeat(40)}:common/arch/provision.sh`,
  ];
  const original = await sourceHashFromEntries(manifest, entries);
  const referenceChanged = await sourceHashFromEntries(manifest, [
    ...entries.slice(0, 2),
    `${"a".repeat(40)}:arch-scroll/distrobox.ini`,
    `${"b".repeat(40)}:arch-scroll/test.lock.toml`,
    ...entries.slice(4),
  ]);
  const containerfileChanged = await sourceHashFromEntries(manifest, [
    `${"c".repeat(40)}:arch-scroll/Containerfile`,
    ...entries.slice(1),
  ]);
  assertEquals(referenceChanged, original);
  assertNotEquals(containerfileChanged, original);
  const commonChanged = await sourceHashFromEntries(manifest, [
    ...entries.slice(0, -1),
    `${"d".repeat(40)}:common/arch/provision.sh`,
  ]);
  assertNotEquals(commonChanged, original);
});
