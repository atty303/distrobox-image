#!/bin/sh
set -eu

if [ "$#" -ne 3 ]; then
  echo "usage: prepare-pkgbuild.sh PKGBUILD DOWNSTREAM_RELEASE SOURCE_COMMIT" >&2
  exit 2
fi

pkgbuild=$1
downstream_release=$2
source_commit=$3
upstream_source="source=(\"git+https://github.com/dawsers/scroll.git#tag=\$pkgver\""

if ! printf '%s\n' "$downstream_release" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+-atty\.[1-9][0-9]*$'; then
  echo "invalid downstream release: $downstream_release" >&2
  exit 1
fi
if ! printf '%s\n' "$source_commit" | grep -Eq '^[0-9a-f]{40}$'; then
  echo "invalid Scroll source commit: $source_commit" >&2
  exit 1
fi
if [ "$(grep -Ec '^pkgver=[^[:space:]]+$' "$pkgbuild")" -ne 1 ]; then
  echo "expected exactly one simple pkgver assignment" >&2
  exit 1
fi
if [ "$(grep -Fxc "$upstream_source" "$pkgbuild")" -ne 1 ]; then
  echo "expected exactly one simple upstream Scroll source array" >&2
  exit 1
fi

package_version=$(printf '%s\n' "$downstream_release" | sed 's/-atty\./.atty./')
sed -i "s|^pkgver=.*$|pkgver=$package_version|" "$pkgbuild"
sed -i "s|^source=(\"git+https://github\\.com/dawsers/scroll\\.git#tag=\\\$pkgver\"$|source=(\"git+https://github.com/atty303/scroll.git#commit=$source_commit\"|" "$pkgbuild"

grep -Fxq "pkgver=$package_version" "$pkgbuild"
grep -Fqx "source=(\"git+https://github.com/atty303/scroll.git#commit=$source_commit\"" "$pkgbuild"
printf '%s\n' "$package_version"
