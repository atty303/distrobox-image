# Distrobox images

This repository builds Arch Linux images for Distrobox. Every published tag has passed image and
reference-Distrobox smoke tests before it is pushed. Tags are immutable; select one and keep it
pinned in your own configuration.

## Images

| Image               | Contents                                          | A new tag is built when                                                       |
| ------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------- |
| `arch-toolbox-paru` | Common toolbox, `paru`, `host-spawn`, `host-exec` | Monthly base rollup, paru release, host-spawn release, or build-source change |
| `arch-scroll`       | Scroll and its companion binaries                 | A Scroll release is also available from the matching AUR package              |
| `arch-dms`          | DankMaterialShell, Quickshell, dsearch, and dgop  | DMS or dsearch releases                                                       |
| `arch-noctalia`     | Noctalia shell and PipeWire/WirePlumber runtime   | The Noctalia AUR package source changes                                       |

Parent updates alone do not republish child images. A child takes the newest published parent on its
next own build.

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

## Update or roll back

Change `image=` in your own configuration and replace only the selected box:

```sh
distrobox assemble create --file ~/.config/distrobox/scroll.ini --replace --name scroll
```

To roll back, restore the previous tag and run the same command. This repository never changes the
tag selected by a consumer.

## Development

Run `mise run check` for static validation and unit tests. `mise run check:all` also builds the
image DAG, exercises the reference Distroboxes, and runs the local Actions check. Maintenance rules
are in [`AGENTS.md`](AGENTS.md).
