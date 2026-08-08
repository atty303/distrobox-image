# Immutable Distrobox images

This repository publishes three Distrobox-oriented Arch images. `arch-toolbox-paru` supplies `paru`,
`host-spawn`, and `host-exec`; `arch-scroll` supplies the Scroll compositor; and `arch-dms` supplies
DankMaterialShell and dsearch.

Only immutable, event-derived tags are published. There is no moving `latest`, `stable`, or
`candidate` tag. Find a tag marked **Available** in the successful **Build immutable images**
Actions summary, then put that exact tag in one of the files under
[`reference/distrobox`](reference/distrobox).

Create or update a box with:

```sh
distrobox assemble create --file reference/distrobox/scroll.ini
distrobox assemble create --file reference/distrobox/scroll.ini --replace --name scroll
```

To roll back, restore the previous immutable `image=` tag and run the same `--replace --name`
command. Keep the working tag in your own Distrobox configuration; this repository never advances it
for you.

Scroll is checked every six hours and waits for its matching AUR package. DMS is rebuilt when either
DMS or dsearch changes. The toolbox base digest is rolled up monthly, while paru, host-spawn, or
repository changes can trigger it sooner. Parent-only changes do not republish children.

Adjust volumes, UID-specific paths, and NVIDIA entries for your host. Contributors should run
`mise run check`; image and Distrobox integration checks are in `mise run check:all`. See
[`AGENTS.md`](AGENTS.md) for the manifest, lock, testing, and maintenance contract.
