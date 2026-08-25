#!/bin/sh
set -eu

root=$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd)
prepare="$root/arch-scroll/prepare-pkgbuild.sh"
temp=$(mktemp -d)
trap 'rm -rf "$temp"' EXIT HUP INT TERM

cat > "$temp/PKGBUILD" <<'EOF'
pkgname=sway-scroll
pkgver=1.12.21
pkgrel=1
source=("git+https://github.com/dawsers/scroll.git#tag=$pkgver"
        "scroll-portals.conf")
sha256sums=('SKIP' 'abc')
EOF

actual=$(
  "$prepare" "$temp/PKGBUILD" 1.12.21-atty.1 0123456789abcdef0123456789abcdef01234567
)
test "$actual" = 1.12.21.atty.1
grep -Fxq 'pkgver=1.12.21.atty.1' "$temp/PKGBUILD"
grep -Fq 'git+https://github.com/atty303/scroll.git#commit=0123456789abcdef0123456789abcdef01234567' "$temp/PKGBUILD"
grep -Fq '"scroll-portals.conf"' "$temp/PKGBUILD"
grep -Fq "sha256sums=('SKIP' 'abc')" "$temp/PKGBUILD"

cp "$temp/PKGBUILD" "$temp/malformed"
sed -i '/github.com\/atty303\/scroll.git/c\source=("https://example.invalid/source")' "$temp/malformed"
if "$prepare" "$temp/malformed" 1.12.21-atty.1 0123456789abcdef0123456789abcdef01234567; then
  echo "accepted a PKGBUILD without the expected upstream source" >&2
  exit 1
fi

if "$prepare" "$temp/PKGBUILD" 1.12.21 0123456789abcdef0123456789abcdef01234567; then
  echo "accepted an invalid downstream release" >&2
  exit 1
fi
