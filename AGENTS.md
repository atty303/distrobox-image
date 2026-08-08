# Repository maintenance contract

This file is the source of truth for implementation and maintenance. `README.md` is the consumer
guide. Preserve immutable publication, reproducible locks, dependency-order builds, and isolation
from the operator's real Distrobox state.

## Image contract

Each image directory contains `Containerfile`, `image.toml`, and `test.lock.toml`. Images with a
reference Distrobox also contain a fixed-name `distrobox.ini`. Manifest schema 2 declares the GHCR
repository, immutable tag template, parent, triggers, image smoke commands, and an optional
reference Distrobox with reference-only smoke commands. Unknown or trigger-inapplicable fields are
errors. Internal parents must exist and the graph must be acyclic. External and persisted lock
parents use `@sha256:`.

Trigger roles are:

- `build`: changes the event key and may create a tag.
- `gate`: blocks a build until its value matches another trigger.
- `input`: is pinned in the production lock but does not create an event by itself.

The event key contains the event and manifest schema versions, image name, build-trigger values, the
image/common build source hash, and an optional force nonce. Monthly OCI triggers contribute the JST
year-month instead of every observed digest. Parent, gate, and input values are excluded. Parent
propagation is always `on-next-build`. Image-local `distrobox.ini` and `test.lock.toml` are also
excluded from the event source hash: changing either requires checks but does not publish a tag.

Only event tags matching the manifest template are published. A tag is pushed only after its local
image and reference-Distrobox smoke tests pass, so existence in GHCR means it passed pre-publish
verification. Never overwrite a tag, publish moving aliases, or add automatic tag cleanup.

## Locks and Containerfiles

`test.lock.toml` is the reviewed local/PR input set. Production locks use the same schema and are
uploaded as artifacts. Trigger types determine required version, commit, digest, URL, checksum, and
build-argument fields. Keep `inputs`, `build_args`, and full OCI-label keys in `expected`
consistent.

Vendor assets require versioned HTTPS URLs and SHA-256. Git and AUR sources use exact commits.
Containerfiles consume only lock arguments, verify downloads, select the locked Arch snapshot,
preserve the non-root builder, record expected metadata, and end with `ENTRYPOINT []`.

## Build and publication

The planner discovers manifests and produces deterministic event tags. The publish command handles
all build items in topological order. If a parent is published in the same run, its resulting GHCR
digest is placed in the child's final production lock. Each image is built, image-smoked, and (when
configured) assembled and smoked with Distrobox before `podman push` is called. Immediately before
push, live inputs are resolved again; any difference from the production lock aborts publication.

GitHub Actions serializes publish runs with concurrency. A partial run may leave already-published
parents; those are valid tested artifacts. Final locks and the successful result list are uploaded
even when a later image fails. Force builds require a reason and create a nonce-backed event tag.

## Deno, mise, and tests

Resolver, planner, validation, orchestration, registry access, and smoke harnesses are Deno
TypeScript. Unit tests get no network permission. Live resolution and container tasks receive only
their declared permissions. Tool and module versions are exact in `.mise.toml`, `mise.lock`,
`deno.json`, and `deno.lock`. Actions are pinned to commit SHAs; the act runner is pinned by digest.
Actions installs the same Distrobox release as the local reference environment from the exact
release commit declared in `.mise.toml`, and the harness always selects Podman explicitly.
Production locks use the newest complete Arch Linux Archive snapshot before the current JST day; 404
probes may fall back up to seven days, while transport and server errors fail resolution.

`mise run check` runs format, lint, typecheck, schema/DAG/lock validation, unit/planner tests, and
actionlint. Image or reference changes require that image's integration test. Parent changes require
the parent and descendants. Common build changes and unknown paths require all images. Run
`mise run check:all` for ordered static checks, full image/Distrobox integration, and act static-job
validation.

## Distrobox isolation

Reference INIs are image-local repository snapshots, not links to dotfiles. The manifest declares
their sections; the file path is always `<image-directory>/distrobox.ini`. The harness transforms a
temporary copy line by line so repeated keys survive. It uses unique names and HOME, `pull=false`,
`start_now=false`, fixture host-volume sources, preserved container targets, hooks, flags, exports,
and rewritten NVIDIA includes. It dry-runs every entry, creates only the base entry, runs image and
reference smoke commands, verifies exported binaries, and removes the container and temporary data.
SIGINT and SIGTERM trigger best-effort cleanup; SIGKILL cannot be handled.

Never modify real HOME, existing containers, or source dotfiles. GPU rendering, real DBus traffic,
and a complete compositor session are outside the smoke scope. A skipped or sandbox-denied test is
not a pass. Keep the caller's `XDG_DATA_HOME` while using the temporary HOME so Distrobox sees the
image built in the caller's rootless Podman storage without exposing the caller's Distrobox
configuration.

The checked-in INI and assemble dry-run always retain the local `keep-id:size=65534` flag. For the
actual create only, the harness removes the unsupported `size` option on Podman versions before 5.4;
current local Podman receives the reference flags unchanged. This compatibility path must not alter
the reference snapshot or hide failures in hooks, volumes, exports, or image smoke commands.

Do not push Git commits, publish images, delete packages/tags, or mutate external services without
explicit permission. Final reports list commands, image targets, results, and tests not run.
