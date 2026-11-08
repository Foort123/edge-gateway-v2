#!/usr/bin/env bash
set -Eeuo pipefail

[[ "$(id -u)" -eq 0 ]] || { echo "run as root" >&2; exit 1; }

for service in wg-quick@wg0.service unbound.service xray.service; do
  systemctl is-active --quiet "$service" || { echo "service inactive: $service" >&2; exit 1; }
done

/usr/local/bin/xray run -test -config /etc/xray/config.json >/dev/null
wg show wg0 listen-port >/dev/null
dig @10.77.0.1 example.com A +short +time=3 +tries=1 | grep -q .

echo "VPN V2 server health check passed."
