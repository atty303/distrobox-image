import type { ImageLock, ImageManifest } from "./types.ts";
import { referencePath } from "./manifest.ts";

export interface MaterializeOptions {
  name: string;
  image: string;
  home: string;
  fixtureRoot: string;
}
export function materializeIni(
  source: string,
  manifest: ImageManifest,
  options: MaterializeOptions,
): string {
  const base = manifest.reference?.section;
  const nvidia = manifest.reference?.nvidia_section;
  let current = "";
  return source.split("\n").map((line) => {
    const section = line.match(/^\[([^\]]+)\]$/);
    if (section) {
      current = section[1];
      if (current === base) return `[${options.name}]`;
      if (current === nvidia) return `[${options.name}-nvidia]`;
    }
    if (current === base) {
      if (line.startsWith("image=")) return `image=${options.image}`;
      if (line.startsWith("pull=")) return "pull=false";
      if (line.startsWith("start_now=")) return "start_now=false";
      if (line.startsWith("home=")) return `home=${options.home}`;
      if (line.startsWith("volume=")) {
        const [sourcePath, ...rest] = line.slice(7).split(":");
        const safeSource = `${options.fixtureRoot}/${
          sourcePath.replace(/^\//, "").replaceAll("/", "_")
        }`;
        return `volume=${safeSource}:${rest.join(":")}`;
      }
    }
    if (current === nvidia && line === `include=${base}`) return `include=${options.name}`;
    return line;
  }).join("\n");
}

async function run(command: string, args: string[], env?: Record<string, string>) {
  const result = await new Deno.Command(command, {
    args,
    env,
    stdin: "null",
    stdout: "inherit",
    stderr: "inherit",
  }).output();
  if (!result.success) throw new Error(`${command} ${args.join(" ")} failed`);
}
export async function smokeDistrobox(
  manifest: ImageManifest,
  lock: ImageLock,
  image: string,
): Promise<void> {
  if (!manifest.reference) return;
  const temp = await Deno.makeTempDir({ prefix: "distrobox-image-" });
  const name = `ci-${manifest.name}-${crypto.randomUUID().slice(0, 8)}`;
  const home = `${temp}/home`;
  const fixtures = `${temp}/volumes`;
  const ini = `${temp}/distrobox.ini`;
  await Deno.mkdir(home, { recursive: true });
  await Deno.mkdir(fixtures, { recursive: true });
  const source = await Deno.readTextFile(referencePath(manifest));
  const transformed = materializeIni(source, manifest, {
    name,
    image,
    home,
    fixtureRoot: fixtures,
  });
  for (const line of transformed.split("\n").filter((l) => l.startsWith("volume="))) {
    await Deno.mkdir(line.slice(7).split(":")[0], { recursive: true });
  }
  await Deno.writeTextFile(ini, transformed);
  const containerData = Deno.env.get("XDG_DATA_HOME") ??
    `${Deno.env.get("HOME")}/.local/share`;
  const env = {
    HOME: home,
    DBX_CONTAINER_MANAGER: "podman",
    XDG_DATA_HOME: containerData,
  };
  const cleanup = async () => {
    const result = await new Deno.Command("distrobox", {
      args: ["rm", "--force", name],
      env,
      stdout: "null",
      stderr: "null",
    }).output();
    return result.success;
  };
  const onSignal = async () => {
    await cleanup();
    try {
      await Deno.remove(temp, { recursive: true });
    } finally {
      Deno.exit(130);
    }
  };
  Deno.addSignalListener("SIGINT", onSignal);
  Deno.addSignalListener("SIGTERM", onSignal);
  let failure: unknown;
  let cleanupSucceeded = true;
  try {
    await run("distrobox", ["assemble", "create", "--file", ini, "--dry-run"], env);
    await run("distrobox", ["assemble", "create", "--file", ini, "--name", name], env);
    const lockEnvironment = Object.entries(lock.inputs).map(([key, value]) =>
      `LOCK_${key.toUpperCase().replaceAll("-", "_")}=${value}`
    );
    for (const smoke of [...manifest.smoke, ...manifest.reference_smoke]) {
      await run(
        "distrobox",
        ["enter", name, "--", "env", ...lockEnvironment, ...smoke.command],
        env,
      );
    }
    const exported = transformed.split("\n").find((line) => line.startsWith("exported_bins="))
      ?.slice("exported_bins=".length).replaceAll('"', "").trim().split(/\s+/) ?? [];
    for (const binary of exported) {
      const path = `${home}/.local/bin/${binary.split("/").pop()}`;
      try {
        await Deno.lstat(path);
      } catch {
        throw new Error(`${manifest.name}: exported binary is missing: ${path}`);
      }
    }
  } catch (error) {
    failure = error;
  } finally {
    cleanupSucceeded = await cleanup();
    await Deno.remove(temp, { recursive: true });
    Deno.removeSignalListener("SIGINT", onSignal);
    Deno.removeSignalListener("SIGTERM", onSignal);
  }
  if (failure) throw failure;
  if (!cleanupSucceeded) throw new Error(`${manifest.name}: Distrobox cleanup failed for ${name}`);
}
