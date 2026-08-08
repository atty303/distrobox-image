import { lockHash } from "./lock.ts";
import type { ImageLock, ImageManifest } from "./types.ts";

export function imageReference(manifest: ImageManifest, tag: string): string {
  return `${manifest.repository}:${tag}`;
}

export async function buildImage(
  manifest: ImageManifest,
  lock: ImageLock,
  tag: string,
): Promise<string> {
  const args = [
    "build",
    "--file",
    `${manifest.directory}/${manifest.containerfile}`,
    "--tag",
    imageReference(manifest, tag),
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
  return imageReference(manifest, tag);
}

async function inspectImage(image: string): Promise<Record<string, unknown>> {
  const inspected = await new Deno.Command("podman", {
    args: ["inspect", image],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!inspected.success) throw new Error(`cannot inspect ${image}`);
  return JSON.parse(new TextDecoder().decode(inspected.stdout))[0] as Record<string, unknown>;
}

export async function smokeImage(
  manifest: ImageManifest,
  lock: ImageLock,
  image: string,
): Promise<void> {
  const lockEnvironment = Object.entries(lock.inputs).flatMap(([key, value]) => [
    "--env",
    `LOCK_${key.toUpperCase().replaceAll("-", "_")}=${value}`,
  ]);
  for (const smoke of manifest.smoke) {
    const checked = await new Deno.Command("podman", {
      args: [
        "run",
        "--rm",
        "--cap-add",
        "SYS_NICE",
        ...lockEnvironment,
        image,
        ...smoke.command,
      ],
      stdin: "null",
      stdout: "inherit",
      stderr: "inherit",
    }).output();
    if (!checked.success) {
      throw new Error(`image smoke failed for ${manifest.name}: ${smoke.command.join(" ")}`);
    }
  }
  const inspected = await inspectImage(image);
  const config = inspected.Config as Record<string, unknown>;
  const labels = config.Labels as Record<string, string>;
  for (const [label, expected] of Object.entries(lock.expected)) {
    if (labels[label] !== expected) {
      throw new Error(`${manifest.name}: expected ${label}=${expected}, got ${labels[label]}`);
    }
  }
  const expectedHash = await lockHash(lock);
  if (labels["io.atty303.distrobox.lock-hash"] !== expectedHash) {
    throw new Error(`${manifest.name}: lock hash label does not match production lock`);
  }
  const entrypoint = config.Entrypoint;
  if (
    entrypoint !== undefined && entrypoint !== null &&
    (!Array.isArray(entrypoint) || entrypoint.length !== 0)
  ) {
    throw new Error(`${manifest.name}: ENTRYPOINT must be empty`);
  }
}

export async function pushImage(image: string): Promise<void> {
  const result = await new Deno.Command("podman", {
    args: ["push", image],
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  }).output();
  if (!result.success) throw new Error(`podman push failed for ${image}`);
}
