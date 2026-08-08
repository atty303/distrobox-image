# Repository maintenance contract

This is the implementation and maintenance source of truth. `README.md` is the short consumer guide.
Changes must preserve immutable publication, reproducible test inputs, and isolation from the
operator's real Distrobox state.

## Image contract

Every image lives in a top-level directory with `Containerfile`, `image.toml`, and `test.lock.toml`.
Domain configuration is TOML. `deno.json`, `deno.lock`, `mise.lock`, and raw API fixtures retain
their native formats.

Manifest schema 1 declares the name, GHCR repository, build context, Containerfile, tag template,
parent, triggers, lock fields, smoke commands, and optional reference INI. Unknown fields, trigger
types, and roles are errors. Internal parents must exist and the graph must be acyclic. External OCI
parents and every lock `BASE_IMAGE` use `@sha256:`. Never introduce a mutable parent.

Trigger roles are:

- `build`: its value participates in the event key and can create an image.
- `gate`: blocks until it matches the named build trigger; it creates no event itself.
- `input`: is captured at build time but creates no event itself.

Parent propagation is `on-next-build`: a new parent never republishes children. A child event uses
the newest existing immutable parent digest. Local parent changes require descendant compatibility
builds. Manual force adds a run nonce and therefore creates a distinct immutable event.

The event key contains schema, image, `build` values, relevant source tree revision, and optional
force nonce. It excludes gate/input values, ordinary Arch churn, and parent digest. Tags use the
manifest template and first eight hash characters. Never push `latest`, `candidate`, or `stable`,
overwrite a tag, or add automatic cleanup.

## Locks and Containerfiles

`test.lock.toml` is a reviewed known-good local/PR input set. Production uses the same schema and is
uploaded as an artifact. Record parent digest, upstream version/revision, AUR PKGBUILD commit,
vendor URL and SHA-256, Arch snapshot, build arguments, and expected versions as applicable. Vendor
downloads need a versioned URL and checksum. Git sources need a commit, never a branch. Update all
corresponding `inputs`, `build_args`, and `expected` values together.

Containerfiles consume lock arguments, verify downloads, use the pinned Arch snapshot, preserve the
non-root `builder`, and end with `ENTRYPOINT []`. Record relevant versions, revisions, lock hash,
snapshot, and Git SHA in OCI labels. If resolution changes during build, stop before publication.

## Deno and mise

Resolver, providers, planner, registry, builder, and Distrobox harness are Deno TypeScript. Inject
time, provider results, and registry state in tests. Fixture/unit tests get no network permission.
Only live tasks get narrowly scoped network, and only harness tasks get run/read/write/env access.

Tool versions come only from exact `.mise.toml` and `mise.lock` entries. Dependencies use exact JSR
versions in `deno.json`; commit generated `deno.lock` and use it frozen. Do not pick versions in a
workflow. Actions are pinned to commit SHAs and should primarily invoke mise tasks and connect
outputs/artifacts.

To add software, add its directory contract and reference config if applicable; do not add a
software-specific workflow branch. A new provider separates parsing from I/O, commits success/error
fixtures, rejects schema drift and unregistered fixture URLs, and adds unit/planner golden cases.
Refresh fixtures with `mise run refresh-fixture -- <provider>` and locks with
`mise run refresh-lock -- <image>`; review every revision and checksum.

## Distrobox isolation

Reference INIs are explicit snapshots, never runtime links to chezmoi. Transform them line by line
so repeated keys survive. Use unique sections/containers, the tested image, `pull=false`,
`start_now=false`, temporary HOME, fixture host volume sources, preserved container targets,
hooks/flags/exports, and a rewritten NVIDIA include. Dry-run both entries, create the base, enter
for smoke commands, check hooks/exports, and clean up on success, failure, or interruption.

Never modify real HOME, existing containers, or source dotfiles. GPU rendering, real DBus traffic,
and a full compositor start are out of scope. A skipped or sandbox-denied integration test is not a
pass: request elevation or report it as not run.

## Required checks

`mise run check` covers format, lint, typecheck, schema/DAG validation, unit/fixture/planner tests,
and actionlint. It should select changed images conservatively; ambiguity means all. Run
`mise run check:all` for fixed-lock builds, reference Distrobox smoke, and local `act`. Parent
changes require descendants. Provider changes require its fixtures and affected planner cases.
Manifest, lock, Containerfile, or reference changes require that image's real build/smoke. Workflow
changes require actionlint and act.

Only the post-publish job fresh-pulling the immutable GHCR tag on a separate runner proves GHCR
verification; `act` does not. Do not git push, publish, delete packages/tags, or mutate external
services without explicit permission. Final reports list commands, images, results, and tests not
run. Immutable tag deletion is always an operator decision.
