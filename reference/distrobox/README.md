# Reference Distrobox definitions

These files are snapshots used by the local and post-publish smoke harness. They deliberately use
the non-existent `reserved-not-published` tag. Replace only `image=` with an immutable tag reported
as verified by the build workflow before using one directly.

The harness rewrites section names, images, pull policy, host volume sources, `start_now`, and HOME
line by line. It preserves repeated keys, container-side mount targets, hooks, flags, exported bins,
and NVIDIA includes. It never reads the user's dotfiles at runtime.
