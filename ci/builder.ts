import { lockHash } from "./lock.ts";
import type { ImageLock, ImageManifest } from "./types.ts";
export async function buildImage(
  manifest: ImageManifest,
  lock: ImageLock,
  tag: string,
  push = false,
): Promise<void> {
  const args = [
    "build",
    "--file",
    `${manifest.directory}/${manifest.containerfile}`,
    "--tag",
    `${manifest.repository}:${tag}`,
  ];
  for (const [key, value] of Object.entries(lock.build_args)) {
    args.push("--build-arg", `${key}=${value}`);
  }
  args.push(
    "--label",
    `io.atty303.distrobox.lock-hash=${await lockHash(lock)}`,
    "--label",
    `org.opencontainers.image.revision=${Deno.env.get("GITHUB_SHA") ?? "local"}`,
    manifest.directory === manifest.context
      ? manifest.directory
      : `${manifest.directory}/${manifest.context}`,
  );
  const result = await new Deno.Command("podman", {
    args,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  }).output();
  if (!result.success) throw new Error(`podman build failed for ${manifest.name}`);
  const image = `${manifest.repository}:${tag}`;
  for (
    const smoke of manifest.smoke.filter((item) =>
      !item.command.join(" ").includes("/usr/local/bin/")
    )
  ) {
    const checked = await new Deno.Command("podman", {
      args: ["run", "--rm", "--cap-add", "SYS_NICE", image, ...smoke.command],
      stdin: "null",
      stdout: "inherit",
      stderr: "inherit",
    }).output();
    if (!checked.success) {
      throw new Error(`image smoke failed for ${manifest.name}: ${smoke.command.join(" ")}`);
    }
  }
  const inspected = await new Deno.Command("podman", {
    args: ["inspect", image],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!inspected.success) throw new Error(`cannot inspect ${image}`);
  const labels = JSON.parse(new TextDecoder().decode(inspected.stdout))[0].Config.Labels as Record<
    string,
    string
  >;
  for (const [field, expected] of Object.entries(lock.expected)) {
    if (!field.endsWith("_version")) continue;
    const component = field.slice(0, -8).replaceAll("_", "-");
    const actual = labels[`io.atty303.distrobox.${component}-version`];
    if (actual !== expected) {
      throw new Error(`${manifest.name}: expected ${component} ${expected}, got ${actual}`);
    }
  }
  if (push) {
    const pushed = await new Deno.Command("podman", {
      args: ["push", `${manifest.repository}:${tag}`],
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    }).output();
    if (!pushed.success) throw new Error(`podman push failed for ${manifest.name}`);
  }
}
