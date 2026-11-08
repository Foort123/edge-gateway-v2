#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

readonly XRAY_VERSION="26.10.31"
readonly XRAY_ARCHIVE_SHA256="e4bd9119f50ae7c41658b1abd0679ae06f98bd864a2907ff33f2f2cf7081b214"
readonly XRAY_ARCHIVE_URL="https://github.com/XTLS/Xray-core/releases/download/v${XRAY_VERSION}/Xray-linux-64.zip"
readonly XRAY_PORT_DEFAULT="443"
readonly WG_PORT_DEFAULT="51820"
readonly WG_SERVER_V4="10.77.0.1"
readonly WG_CLIENT_V4="10.77.0.2"
readonly WG_SERVER_V6="fd42:77::1"
readonly WG_CLIENT_V6="fd42:77::2"

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ENDPOINT=""
REALITY_TARGET=""
REALITY_SERVER_NAME=""
XRAY_PORT="$XRAY_PORT_DEFAULT"
WG_PORT="$WG_PORT_DEFAULT"
ACK_FRESH_SERVER=0

usage() {
  cat <<'USAGE'
Usage (Ubuntu Server 24.04, fresh VPS only):
  sudo bash setup.sh \
    --endpoint <public-IP-or-hostname> \
    --reality-target <same-ASN-hostname:443> \
    --ack-fresh-server

Optional:
  --sni <hostname>       defaults to the hostname in --reality-target
  --xray-port <port>     defaults to 443/TCP
  --wireguard-port <port> defaults to 51820/UDP

The script generates the VLESS UUID, WireGuard keys, and REALITY keys locally
on the VPS. Client profiles are written under /root/vpn-v2/clients with mode
0600. Copy them over SSH; never paste them into logs or Git.
USAGE
}

fail() {
  echo "error: $*" >&2
  exit 1
}

while (($#)); do
  case "$1" in
    --endpoint)
      (($# >= 2)) || fail "--endpoint requires a value"
      ENDPOINT="$2"
      shift 2
      ;;
    --reality-target)
      (($# >= 2)) || fail "--reality-target requires a value"
      REALITY_TARGET="$2"
      shift 2
      ;;
    --sni)
      (($# >= 2)) || fail "--sni requires a value"
      REALITY_SERVER_NAME="$2"
      shift 2
      ;;
    --xray-port)
      (($# >= 2)) || fail "--xray-port requires a value"
      XRAY_PORT="$2"
      shift 2
      ;;
    --wireguard-port)
      (($# >= 2)) || fail "--wireguard-port requires a value"
      WG_PORT="$2"
      shift 2
      ;;
    --ack-fresh-server)
      ACK_FRESH_SERVER=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail "unknown argument: $1"
      ;;
  esac
done

[[ "$(id -u)" -eq 0 ]] || fail "run as root on the VPS"
[[ "$ACK_FRESH_SERVER" -eq 1 ]] || fail "review the script and pass --ack-fresh-server only on a new, dedicated VPS"
[[ -n "$ENDPOINT" && -n "$REALITY_TARGET" ]] || { usage >&2; exit 2; }
[[ "$XRAY_PORT" =~ ^[0-9]+$ ]] && ((XRAY_PORT >= 1 && XRAY_PORT <= 65535)) || fail "invalid Xray TCP port"
[[ "$WG_PORT" =~ ^[0-9]+$ ]] && ((WG_PORT >= 1 && WG_PORT <= 65535)) || fail "invalid WireGuard UDP port"
[[ "$ENDPOINT" =~ ^(\[[0-9A-Fa-f:]+\]|[A-Za-z0-9][A-Za-z0-9.-]*[A-Za-z0-9])$ ]] || fail "endpoint must be a public IP address or DNS hostname (no port)"
[[ "$REALITY_TARGET" =~ ^([A-Za-z0-9][A-Za-z0-9.-]*[A-Za-z0-9]):443$ ]] || fail "REALITY target must be a DNS hostname on port 443"
TARGET_HOST="${REALITY_TARGET%:443}"
if [[ -z "$REALITY_SERVER_NAME" ]]; then
  REALITY_SERVER_NAME="$TARGET_HOST"
fi
[[ "$REALITY_SERVER_NAME" == "$TARGET_HOST" ]] || fail "SNI must match the REALITY target hostname"
[[ "$REALITY_SERVER_NAME" =~ ^[A-Za-z0-9][A-Za-z0-9.-]*[A-Za-z0-9]$ ]] || fail "invalid SNI hostname"

[[ -r /etc/os-release ]] || fail "cannot identify operating system"
# shellcheck disable=SC1091
. /etc/os-release
[[ "${ID:-}" == "ubuntu" && "${VERSION_ID:-}" == "24.04" ]] || fail "only a fresh Ubuntu Server 24.04 host is supported"
[[ "$(dpkg --print-architecture)" == "amd64" ]] || fail "the pinned Xray release is for amd64; choose an Ubuntu amd64 VPS"
[[ "$(ps -p 1 -o comm= | tr -d ' ')" == "systemd" ]] || fail "systemd is required"

if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
  fail "active UFW detected; review firewall forwarding rules before using this installer"
fi
for firewall_service in firewalld nftables; do
  if systemctl is-active --quiet "${firewall_service}.service"; then
    fail "active ${firewall_service} service detected; review firewall forwarding rules before using this installer"
  fi
done
if [[ -e /etc/wireguard/wg0.conf || -e /etc/xray/config.json || -e /etc/vpn-v2/installed ]]; then
  fail "existing VPN configuration detected; this is an install-only script for a fresh VPS"
fi

if command -v ss >/dev/null 2>&1; then
  ss -H -lnt "sport = :${XRAY_PORT}" | grep -q . && fail "TCP port ${XRAY_PORT} is already in use"
  ss -H -lun "sport = :${WG_PORT}" | grep -q . && fail "UDP port ${WG_PORT} is already in use"
fi

apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
  ca-certificates curl dnsutils iproute2 iptables openssl python3 unzip unbound wireguard-tools
ip6tables -t nat -S >/dev/null 2>&1 || fail "IPv6 netfilter is required to prevent client IPv6 leaks"

python3 - "$ENDPOINT" <<'PY'
import ipaddress
import socket
import sys

endpoint = sys.argv[1].strip("[]")
try:
    addresses = [ipaddress.ip_address(endpoint)]
except ValueError:
    try:
        addresses = [ipaddress.ip_address(item[4][0]) for item in socket.getaddrinfo(endpoint, None)]
    except OSError as exc:
        raise SystemExit(f"endpoint hostname did not resolve: {exc}")
if not addresses or not any(address.is_global for address in addresses):
    raise SystemExit("endpoint must resolve to at least one public IP address")
PY

TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf -- "$TMP_DIR"
}
trap cleanup EXIT

curl --fail --show-error --location --retry 3 --retry-delay 2 \
  --output "$TMP_DIR/xray-linux-amd64.zip" "$XRAY_ARCHIVE_URL"
printf '%s  %s\n' "$XRAY_ARCHIVE_SHA256" "$TMP_DIR/xray-linux-amd64.zip" | sha256sum --check --status \
  || fail "Xray release SHA-256 verification failed"
unzip -q "$TMP_DIR/xray-linux-amd64.zip" -d "$TMP_DIR/xray"
[[ -x "$TMP_DIR/xray/xray" ]] || fail "official Xray archive did not contain the expected binary"
install -o root -g root -m 0755 "$TMP_DIR/xray/xray" /usr/local/bin/xray

XRAY_KEYS="$(/usr/local/bin/xray x25519)"
XRAY_PRIVATE_KEY="$(printf '%s\n' "$XRAY_KEYS" | awk -F': ' '/^PrivateKey:/ { print $2; exit }')"
XRAY_PUBLIC_KEY="$(printf '%s\n' "$XRAY_KEYS" | awk -F': ' '/^Password \(PublicKey\):/ { print $2; exit }')"
[[ -n "$XRAY_PRIVATE_KEY" && -n "$XRAY_PUBLIC_KEY" ]] || fail "could not generate Xray REALITY key pair"
VLESS_UUID="$(python3 -c 'import uuid; print(uuid.uuid4())')"
REALITY_SHORT_ID="$(openssl rand -hex 8)"

WG_SERVER_PRIVATE_KEY="$(wg genkey)"
WG_SERVER_PUBLIC_KEY="$(printf '%s' "$WG_SERVER_PRIVATE_KEY" | wg pubkey)"
WG_CLIENT_PRIVATE_KEY="$(wg genkey)"
WG_CLIENT_PUBLIC_KEY="$(printf '%s' "$WG_CLIENT_PRIVATE_KEY" | wg pubkey)"
WG_PRESHARED_KEY="$(wg genpsk)"
WAN_IF="$(ip -4 route show default | awk 'NR == 1 { print $5 }')"
[[ -n "$WAN_IF" ]] || fail "no IPv4 default route was found"

getent ahosts "$TARGET_HOST" >/dev/null || fail "REALITY target does not resolve on the VPS"

if ! getent group xray >/dev/null; then
  groupadd --system xray
fi
if ! id xray >/dev/null 2>&1; then
  useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin --gid xray xray
fi

install -d -o root -g xray -m 0750 /etc/xray
install -d -o root -g root -m 0700 /etc/vpn-v2 /root/vpn-v2/clients
VLESS_UUID="$VLESS_UUID" \
XRAY_PRIVATE_KEY="$XRAY_PRIVATE_KEY" \
REALITY_TARGET="$REALITY_TARGET" \
REALITY_SERVER_NAME="$REALITY_SERVER_NAME" \
REALITY_SHORT_ID="$REALITY_SHORT_ID" \
XRAY_PORT="$XRAY_PORT" \
  python3 "$SCRIPT_DIR/render_xray_config.py" --output /etc/xray/config.json
chown root:xray /etc/xray/config.json
/usr/local/bin/xray run -test -config /etc/xray/config.json

cat >/etc/systemd/system/xray.service <<'UNIT'
[Unit]
Description=Xray VLESS REALITY gateway (VPN V2)
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
User=xray
Group=xray
ExecStart=/usr/local/bin/xray run -config /etc/xray/config.json
Restart=on-failure
RestartSec=3s
LimitNOFILE=1048576
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
AmbientCapabilities=CAP_NET_BIND_SERVICE
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
LockPersonality=true

[Install]
WantedBy=multi-user.target
UNIT

cat >/etc/sysctl.d/99-vpn-v2.conf <<SYSCTL
net.ipv4.ip_forward=1
net.ipv6.conf.all.forwarding=1
net.ipv6.conf.default.forwarding=1
net.ipv6.conf.${WAN_IF}.accept_ra=2
SYSCTL
sysctl --system >/dev/null

install -o root -g root -m 0755 "$SCRIPT_DIR/wg-nat.sh" /usr/local/sbin/vpn-v2-wg-nat
install -o root -g root -m 0755 "$SCRIPT_DIR/healthcheck.sh" /usr/local/sbin/vpn-v2-healthcheck
install -o root -g root -m 0755 "$SCRIPT_DIR/update-xray.sh" /usr/local/sbin/vpn-v2-update-xray
cat >/etc/wireguard/wg0.conf <<WGCONF
[Interface]
Address = ${WG_SERVER_V4}/24, ${WG_SERVER_V6}/64
ListenPort = ${WG_PORT}
PrivateKey = ${WG_SERVER_PRIVATE_KEY}
MTU = 1380
PostUp = /usr/local/sbin/vpn-v2-wg-nat up %i
PostDown = /usr/local/sbin/vpn-v2-wg-nat down %i
SaveConfig = false

[Peer]
# Initial client profile: client-1
PublicKey = ${WG_CLIENT_PUBLIC_KEY}
PresharedKey = ${WG_PRESHARED_KEY}
AllowedIPs = ${WG_CLIENT_V4}/32, ${WG_CLIENT_V6}/128
WGCONF
chmod 0600 /etc/wireguard/wg0.conf

cat >/etc/unbound/unbound.conf.d/vpn-v2.conf <<'UNBOUND'
server:
  interface: 10.77.0.1
  interface: fd42:77::1
  access-control: 10.77.0.0/24 allow
  access-control: fd42:77::/64 allow
  hide-identity: yes
  hide-version: yes
  qname-minimisation: yes
  harden-dnssec-stripped: yes
  tls-cert-bundle: "/etc/ssl/certs/ca-certificates.crt"

forward-zone:
  name: "."
  forward-tls-upstream: yes
  forward-addr: 1.1.1.1@853#cloudflare-dns.com
  forward-addr: 1.0.0.1@853#cloudflare-dns.com
UNBOUND
chown root:unbound /etc/unbound/unbound.conf.d/vpn-v2.conf
chmod 0640 /etc/unbound/unbound.conf.d/vpn-v2.conf
unbound-checkconf
install -d -o root -g root -m 0755 /etc/systemd/system/unbound.service.d
cat >/etc/systemd/system/unbound.service.d/vpn-v2.conf <<'DROPIN'
[Unit]
Requires=wg-quick@wg0.service
After=wg-quick@wg0.service
DROPIN

systemctl daemon-reload
systemctl enable --now wg-quick@wg0.service
systemctl enable --now unbound.service
systemctl enable --now xray.service

VLESS_UUID="$VLESS_UUID" \
XRAY_PUBLIC_KEY="$XRAY_PUBLIC_KEY" \
REALITY_SERVER_NAME="$REALITY_SERVER_NAME" \
REALITY_SHORT_ID="$REALITY_SHORT_ID" \
ENDPOINT="$ENDPOINT" \
XRAY_PORT="$XRAY_PORT" \
  python3 "$SCRIPT_DIR/render_vless_profile.py" --output /root/vpn-v2/clients/vless-client-1.txt

cat >/root/vpn-v2/clients/wireguard-client-1.conf <<WGCLIENT
[Interface]
PrivateKey = ${WG_CLIENT_PRIVATE_KEY}
Address = ${WG_CLIENT_V4}/32, ${WG_CLIENT_V6}/128
DNS = ${WG_SERVER_V4}, ${WG_SERVER_V6}
MTU = 1380

[Peer]
PublicKey = ${WG_SERVER_PUBLIC_KEY}
PresharedKey = ${WG_PRESHARED_KEY}
Endpoint = ${ENDPOINT}:${WG_PORT}
AllowedIPs = 0.0.0.0/0, ::/0
PersistentKeepalive = 25
WGCLIENT
chmod 0600 /root/vpn-v2/clients/wireguard-client-1.conf /root/vpn-v2/clients/vless-client-1.txt

cat >/etc/vpn-v2/installed <<MARKER
VPN V2 installed on Ubuntu ${VERSION_ID}
Xray ${XRAY_VERSION} (${XRAY_ARCHIVE_SHA256})
Xray TCP port ${XRAY_PORT}; WireGuard UDP port ${WG_PORT}
Endpoint ${ENDPOINT}
Reality target ${REALITY_TARGET}
MARKER
chmod 0600 /etc/vpn-v2/installed

systemctl is-active --quiet wg-quick@wg0.service || fail "WireGuard did not start; inspect journalctl -u wg-quick@wg0"
systemctl is-active --quiet unbound.service || fail "Unbound did not start; inspect journalctl -u unbound"
systemctl is-active --quiet xray.service || fail "Xray did not start; inspect journalctl -u xray"
/usr/local/sbin/vpn-v2-healthcheck

cat <<SUMMARY
VPN V2 services are active.
Client profiles are stored privately under /root/vpn-v2/clients (mode 0600).
Open TCP ${XRAY_PORT} and UDP ${WG_PORT} in the VPS provider firewall.
WireGuard DNS uses the VPS Unbound resolver, which forwards over DoT to Cloudflare.
Xray server-side DNS uses Cloudflare DoH.
IPv6 is routed inside the tunnel; if the VPS has no public IPv6 egress, IPv6 destinations fail closed.
SUMMARY
