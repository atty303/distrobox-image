# Distrobox images

This repository builds Arch Linux images for Distrobox. Every published tag has passed image and
reference-Distrobox smoke tests before it is pushed. Tags are immutable; select one and keep it
pinned in your own configuration.

## Images

| Image               | Contents                                            | A new tag is built when                                       |
| ------------------- | --------------------------------------------------- | ------------------------------------------------------------- |
| `arch-toolbox-paru` | Toolbox with `paru`, `host-spawn`, and `host-exec`  | paru or the shared build overlay changes                      |
| `arch-scroll`       | Downstream Scroll with local patches and companions | The downstream Scroll release or shared build overlay changes |
| `arch-noctalia`     | Noctalia git shell and PipeWire/WirePlumber runtime | Noctalia main, its AUR package, or shared overlay changes     |
| `arch-vicinae`      | Vicinae application launcher                        | The Vicinae AUR source or shared build overlay changes        |

Each image is independent and starts directly from the locked Arch Toolbx base. Base and other
input-only updates are adopted the next time an image has its own build event; they do not create
tags by themselves. Changes to the repository's shared Arch build overlay rebuild every image. This
overlay includes the reviewed `host-spawn` version, download URL, and SHA-256 pin in
`common/arch/host-spawn.env`; daily resolution does not update that pin.

`arch-scroll` follows stable releases from `atty303/scroll`. At each image event it locks the
current `sway-scroll` AUR commit as a build recipe, then changes only that recipe's `pkgver` and
Scroll source to the exact downstream release commit. AUR publication timing therefore neither gates
nor triggers the image; dependency and packaging changes are adopted from the recipe available when
the next downstream image is built.

The retained `arch-dms` sources are inactive. Its manifest is named `image.toml.disabled`, so
discovery, validation, CI builds, and publication exclude it.

## Use an image

Find the tag in the **Published** section of a successful **Build immutable images** Actions run.
Copy a reference definition into your own Distrobox configuration, then replace its reserved
`image=` value with that exact tag.

```sh
mkdir -p ~/.config/distrobox
cp arch-scroll/distrobox.ini ~/.config/distrobox/scroll.ini
# Edit ~/.config/distrobox/scroll.ini and set image= to the published immutable tag.
distrobox assemble create --file ~/.config/distrobox/scroll.ini
```

Adjust UID-specific paths, volumes, and the NVIDIA entry for your host.

Noctalia runs application desktop entries inside its container by default. Route those commands
through `host-exec` by adding this to `~/.config/noctalia/config.toml`:

```toml
[shell]
launch_apps_as_systemd_services = false
launch_apps_custom_command = "host-exec $CMD"

[lockscreen]
enabled = false
```

Use the host compositor's screen locker. A rootless Distrobox does not authenticate against the
host's PAM password database.

Vicinae reads the mounted host application metadata. Set its **Applications Launch Prefix** to
`host-exec` so selected desktop applications start on the host. The reference INI leaves
`/dev/input` and `/dev/uinput` as commented examples; enable them only if a Vicinae feature you use
requires direct input-device access.

## Update or roll back

Change `image=` in your own configuration and replace only the selected box:

```sh
distrobox assemble create --file ~/.config/distrobox/scroll.ini --replace --name scroll
```

To roll back, restore the previous tag and run the same command. This repository never changes the
tag selected by a consumer.

## Development

Run `mise run check` for static validation and unit tests. `mise run check:all` also builds the
images, exercises the reference Distroboxes, and runs the local Actions check. Maintenance rules are
in [`AGENTS.md`](AGENTS.md).
