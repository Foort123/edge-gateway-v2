#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

usage() {
  echo "Usage: sudo bash update-xray.sh <version-without-v> <sha256-from-official-GitHub-release>" >&2
}

[[ "$(id -u)" -eq 0 ]] || { echo "run as root" >&2; exit 1; }
if (($# != 2)); then usage; exit 2; fi

VERSION="$1"
EXPECTED_SHA256="${2,,}"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { usage; exit 2; }
[[ "$EXPECTED_SHA256" =~ ^[0-9a-f]{64}$ ]] || { usage; exit 2; }
[[ -x /usr/local/bin/xray && -r /etc/xray/config.json ]] || { echo "Xray V2 is not installed" >&2; exit 1; }

TMP_DIR="$(mktemp -d)"
trap 'rm -rf -- "$TMP_DIR"' EXIT
ARCHIVE="$TMP_DIR/xray.zip"
NEW_BINARY="$TMP_DIR/xray"
URL="https://github.com/XTLS/Xray-core/releases/download/v${VERSION}/Xray-linux-64.zip"

curl --fail --show-error --location --retry 3 --retry-delay 2 --output "$ARCHIVE" "$URL"
printf '%s  %s\n' "$EXPECTED_SHA256" "$ARCHIVE" | sha256sum --check --status \
  || { echo "release SHA-256 verification failed" >&2; exit 1; }
unzip -q "$ARCHIVE" -d "$TMP_DIR/unpacked"
[[ -x "$TMP_DIR/unpacked/xray" ]] || { echo "release archive has no Xray binary" >&2; exit 1; }
install -o root -g root -m 0755 "$TMP_DIR/unpacked/xray" "$NEW_BINARY"
"$NEW_BINARY" run -test -config /etc/xray/config.json

BACKUP="/usr/local/bin/xray.vpn-v2-backup"
cp --preserve=mode,ownership,timestamps /usr/local/bin/xray "$BACKUP"
install -o root -g root -m 0755 "$NEW_BINARY" /usr/local/bin/xray
if systemctl restart xray.service && systemctl is-active --quiet xray.service; then
  echo "Xray upgraded to ${VERSION}; previous binary is at ${BACKUP}."
else
  echo "new Xray failed to start; restoring previous binary" >&2
  install -o root -g root -m 0755 "$BACKUP" /usr/local/bin/xray
  systemctl restart xray.service || true
  exit 1
fi
