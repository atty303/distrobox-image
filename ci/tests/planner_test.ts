import { assertEquals } from "@std/assert";
import { loadLock } from "../lock.ts";
import { discoverManifests } from "../manifest.ts";
import { eventKey, planImage, renderTag } from "../planner.ts";
import { MemoryRegistry } from "../registry.ts";
import { productionLock } from "../resolver.ts";
Deno.test("event keys ignore input and parent values", async () => {
  const manifest = (await discoverManifests()).find((m) => m.name === "arch-scroll")!;
  const a = { scroll: { value: "1.2.3" }, aur: { value: "1.2.3" }, parent: { value: "aaa" } };
  const b = { ...a, parent: { value: "bbb" } };
  const now = new Date("2026-08-01T00:00:00Z");
  assertEquals(await eventKey(manifest, a, "tree", now), await eventKey(manifest, b, "tree", now));
});
Deno.test("monthly trigger rolls digest changes into one JST month", async () => {
  const manifest = (await discoverManifests()).find((m) => m.name === "arch-toolbox-paru")!;
  const a = {
    base: { value: "sha256:aaa" },
    paru: { value: "2.2.0" },
    "host-spawn": { value: "1.7.0" },
  };
  const b = { ...a, base: { value: "sha256:bbb" } };
  const august = new Date("2026-08-20T00:00:00Z");
  const september = new Date("2026-09-01T00:00:00Z");
  assertEquals(
    await eventKey(manifest, a, "tree", august),
    await eventKey(manifest, b, "tree", august),
  );
  assertEquals(
    await eventKey(manifest, a, "tree", august) === await eventKey(manifest, a, "tree", september),
    false,
  );
});
Deno.test("gate mismatch waits", async () => {
  const manifest = (await discoverManifests()).find((m) => m.name === "arch-scroll")!;
  const resolved = { scroll: { value: "2" }, aur: { value: "1" }, source: { value: "tree" } };
  const lock = await loadLock(`${manifest.directory}/test.lock.toml`, manifest);
  const item = await planImage(manifest, resolved, "tree", lock, new MemoryRegistry(), {
    now: new Date("2026-08-01T00:00:00Z"),
  });
  assertEquals(item.action, "wait");
});
Deno.test("tag rendering is deterministic", () =>
  assertEquals(
    renderTag("x-{x.version}-{event_hash8}", { x: { value: "v1.0" } }, "abcdef012345", new Date()),
    "x-1.0-abcdef01",
  ));
Deno.test("tag year and month use JST", () =>
  assertEquals(
    renderTag(
      "arch-{year}-{month}-{event_hash8}",
      {},
      "abcdef012345",
      new Date("2026-01-31T18:00:00Z"),
    ),
    "arch-2026-02-abcdef01",
  ));
Deno.test("production lock maps provider metadata", async () => {
  const manifest = (await discoverManifests()).find((m) => m.name === "arch-toolbox-paru")!;
  const resolved = {
    base: { value: `sha256:${"a".repeat(64)}` },
    paru: {
      value: "2.2.0",
      metadata: { asset_url: "https://example/paru", asset_sha256: "b".repeat(64) },
    },
    "paru-source": { value: "d".repeat(40) },
    "host-spawn": {
      value: "1.7.0",
      metadata: { asset_url: "https://example/host-spawn", asset_sha256: "c".repeat(64) },
    },
    source: { value: "tree" },
  };
  const lock = productionLock(
    manifest,
    resolved,
    `quay.io/toolbx/arch-toolbox@sha256:${"a".repeat(64)}`,
    "2026/08/01",
  );
  assertEquals(lock.build_args.PARU_VERSION, "2.2.0");
  assertEquals(lock.build_args.PARU_COMMIT, "d".repeat(40));
  assertEquals(lock.inputs.host_spawn_sha256, "c".repeat(64));
});
