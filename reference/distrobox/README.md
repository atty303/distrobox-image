# Reference Distrobox definitions

These definitions are test fixtures and starting points for consumer configuration. Copy one to your
own configuration and replace only `image=` with a published immutable tag. The reserved tag in this
directory is intentionally unusable.

The smoke harness transforms a temporary copy line by line. It uses a unique container and HOME,
replaces host volume sources with fixtures, disables pulls and `start_now`, and preserves hooks,
flags, exports, container-side mount targets, and NVIDIA includes.
