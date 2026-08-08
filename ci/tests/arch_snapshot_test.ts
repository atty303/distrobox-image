import { assertEquals, assertRejects } from "@std/assert";
import { resolveArchSnapshot } from "../providers/arch_snapshot.ts";

Deno.test("Arch snapshot selects the newest complete previous JST day", async () => {
  const requested: string[] = [];
  const snapshot = await resolveArchSnapshot(
    new Date("2026-08-08T04:00:00Z"),
    (input) => {
      const url = String(input);
      requested.push(url);
      return Promise.resolve(
        new Response(null, { status: url.includes("2026/08/07") ? 404 : 200 }),
      );
    },
  );
  assertEquals(snapshot, "2026/08/06");
  assertEquals(requested, [
    "https://archive.archlinux.org/repos/2026/08/07/core/os/x86_64/core.db",
    "https://archive.archlinux.org/repos/2026/08/06/core/os/x86_64/core.db",
    "https://archive.archlinux.org/repos/2026/08/06/extra/os/x86_64/extra.db",
  ]);
});

Deno.test("Arch snapshot does not hide server errors", async () => {
  await assertRejects(
    () =>
      resolveArchSnapshot(
        new Date("2026-08-08T04:00:00Z"),
        () => Promise.resolve(new Response(null, { status: 503 })),
      ),
    Error,
    "HTTP 503",
  );
});
