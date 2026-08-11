#!/bin/sh
set -eu

test -n "${ARCH_SNAPSHOT:-}"

common_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "${common_dir}/host-spawn.env"
test -n "${HOST_SPAWN_VERSION:-}"
test -n "${HOST_SPAWN_URL:-}"
test -n "${HOST_SPAWN_SHA256:-}"

printf 'Server = https://archive.archlinux.org/repos/%s/$repo/os/$arch\n' \
  "${ARCH_SNAPSHOT}" > /etc/pacman.d/mirrorlist

attempt=1
while ! pacman -Syu --needed --noconfirm base-devel sudo curl ca-certificates git; do
  test "${attempt}" -lt 3 || exit 1
  sleep "${attempt}"
  attempt=$((attempt + 1))
done

if ! id builder >/dev/null 2>&1; then
  useradd -u 2000 -d /var/build -m -g wheel builder
fi
chmod 0755 /var/build
printf 'builder ALL=(ALL) NOPASSWD: ALL\n' > /etc/sudoers.d/builder
chmod 0440 /etc/sudoers.d/builder

curl --fail --location --output /usr/bin/host-spawn "${HOST_SPAWN_URL}"
echo "${HOST_SPAWN_SHA256}  /usr/bin/host-spawn" | sha256sum --check --strict
chmod 0755 /usr/bin/host-spawn
test "$(host-spawn --version)" = "v${HOST_SPAWN_VERSION}"
install -Dm0755 "${common_dir}/host-exec.sh" /usr/bin/host-exec
