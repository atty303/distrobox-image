import { assertEquals, assertMatch, assertRejects } from "@std/assert";
import { loadLock } from "../lock.ts";
import { discoverManifests } from "../manifest.ts";
import { eventKey, planImage, renderTag, tagPattern } from "../planner.ts";
import { MemoryRegistry } from "../registry.ts";
import { productionLock } from "../resolver.ts";
Deno.test("event keys ignore input trigger values", async () => {
  const manifest = (await discoverManifests()).find((m) => m.name === "arch-scroll")!;
  const a = {
    aur: { value: "1.2.3", revision: "a".repeat(40) },
    "host-spawn": { value: "1.6.2" },
  };
  const b = { ...a, "host-spawn": { value: "1.7.0" } };
  assertEquals(await eventKey(manifest, a, "tree"), await eventKey(manifest, b, "tree"));
});
Deno.test("AUR source commits create Scroll build events", async () => {
  const manifest = (await discoverManifests()).find((m) => m.name === "arch-scroll")!;
  const a = { aur: { value: "1.2.3", revision: "a".repeat(40) } };
  const b = { aur: { value: "1.2.3", revision: "b".repeat(40) } };
  assertEquals(
    await eventKey(manifest, a, "tree") === await eventKey(manifest, b, "tree"),
    false,
  );
});
Deno.test("Noctalia source and AUR commits create build events", async () => {
  const manifest = (await discoverManifests()).find((m) => m.name === "arch-noctalia")!;
  const resolved = {
    aur: { value: "5.0.0.r1.g111111111", revision: "a".repeat(40) },
    noctalia: { value: "b".repeat(40) },
    "host-spawn": { value: "1.6.2" },
  };
  const key = await eventKey(manifest, resolved, "tree");
  assertEquals(
    key === await eventKey(manifest, {
      ...resolved,
      aur: { ...resolved.aur, revision: "c".repeat(40) },
    }, "tree"),
    false,
  );
  assertEquals(
    key === await eventKey(manifest, {
      ...resolved,
      noctalia: { value: "d".repeat(40) },
    }, "tree"),
    false,
  );
  assertEquals(
    renderTag(manifest.tag, resolved, key),
    `noctalia-git-${key.slice(0, 8)}`,
  );
});
Deno.test("tag rendering is deterministic", () =>
  assertEquals(
    renderTag("x-{x.version}-{event_hash8}", { x: { value: "v1.0" } }, "abcdef012345"),
    "x-1.0-abcdef01",
  ));
Deno.test("tag pattern accepts only the manifest's immutable tags", async () => {
  const manifest = (await discoverManifests()).find((item) => item.name === "arch-scroll")!;
  assertMatch("scroll-1.12.17-abcdef01", tagPattern(manifest.tag));
  assertEquals(tagPattern(manifest.tag).test("latest"), false);
  assertEquals(tagPattern(manifest.tag).test("verified-scroll-1.12.17-abcdef01"), false);
});
Deno.test("existing published tag skips and force requires a reason", async () => {
  const manifest = (await discoverManifests()).find((item) => item.name === "arch-scroll")!;
  const resolved = { aur: { value: "1", revision: "a".repeat(40) } };
  const lock = await loadLock(`${manifest.directory}/test.lock.toml`, manifest);
  const key = await eventKey(manifest, resolved, "tree");
  const tag = renderTag(manifest.tag, resolved, key);
  const item = await planImage(
    manifest,
    resolved,
    "tree",
    lock,
    new MemoryRegistry(new Set([`${manifest.repository}:${tag}`])),
    {},
  );
  assertEquals(item.action, "skip");
  await assertRejects(
    () =>
      planImage(manifest, resolved, "tree", lock, new MemoryRegistry(), {
        force: true,
        nonce: "run-1",
      }),
    Error,
    "requires a reason",
  );
});
Deno.test("production lock maps provider metadata", async () => {
  const manifest = (await discoverManifests()).find((m) => m.name === "arch-toolbox-paru")!;
  const resolved = {
    paru: {
      value: "2.2.0",
      metadata: { asset_url: "https://example/paru", asset_sha256: "b".repeat(64) },
    },
    "paru-source": { value: "d".repeat(40) },
    "host-spawn": {
      value: "1.7.0",
      metadata: { asset_url: "https://example/host-spawn", asset_sha256: "c".repeat(64) },
    },
  };
  const lock = productionLock(
    manifest,
    resolved,
    `sha256:${"a".repeat(64)}`,
    "2026/08/01",
  );
  assertEquals(lock.build_args.PARU_VERSION, "2.2.0");
  assertEquals(lock.build_args.PARU_COMMIT, "d".repeat(40));
  assertEquals(lock.inputs.host_spawn_sha256, "c".repeat(64));
  assertEquals(lock.inputs.base_digest, `sha256:${"a".repeat(64)}`);
  assertEquals(
    lock.build_args.BASE_IMAGE,
    `quay.io/toolbx/arch-toolbox@sha256:${"a".repeat(64)}`,
  );
  assertEquals(lock.expected["io.atty303.distrobox.paru-version"], "2.2.0");
});
