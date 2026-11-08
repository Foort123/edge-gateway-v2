#!/usr/bin/env bash
set -Eeuo pipefail

ACTION="${1:-}"
INTERFACE="${2:-wg0}"
WAN_IF="$(ip -4 route show default | awk 'NR == 1 { print $5 }')"

if [[ "$ACTION" != "up" && "$ACTION" != "down" ]]; then
  echo "usage: $0 up|down [wg-interface]" >&2
  exit 2
fi
if [[ ! "$INTERFACE" =~ ^[a-zA-Z0-9_.-]{1,15}$ || -z "$WAN_IF" ]]; then
  echo "could not determine a valid VPN or WAN interface" >&2
  exit 1
fi

ensure_rule() {
  local binary="$1"
  shift
  local table_options=()
  if [[ "${1:-}" == "-t" ]]; then
    table_options=("$1" "$2")
    shift 2
  fi
  if ! "$binary" "${table_options[@]}" -C "$@" 2>/dev/null; then
    "$binary" "${table_options[@]}" -A "$@"
  fi
}

remove_rule() {
  local binary="$1"
  shift
  local table_options=()
  if [[ "${1:-}" == "-t" ]]; then
    table_options=("$1" "$2")
    shift 2
  fi
  while "$binary" "${table_options[@]}" -C "$@" 2>/dev/null; do
    "$binary" "${table_options[@]}" -D "$@"
  done
}

IPV4_FORWARD_OUT=(FORWARD -i "$INTERFACE" -o "$WAN_IF" -s 10.77.0.0/24 -j ACCEPT)
IPV4_FORWARD_IN=(FORWARD -i "$WAN_IF" -o "$INTERFACE" -d 10.77.0.0/24 -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT)
IPV4_NAT=(POSTROUTING -s 10.77.0.0/24 -o "$WAN_IF" -j MASQUERADE)
IPV6_FORWARD_OUT=(FORWARD -i "$INTERFACE" -o "$WAN_IF" -s fd42:77::/64 -j ACCEPT)
IPV6_FORWARD_IN=(FORWARD -i "$WAN_IF" -o "$INTERFACE" -d fd42:77::/64 -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT)
IPV6_NAT=(POSTROUTING -s fd42:77::/64 -o "$WAN_IF" -j MASQUERADE)

case "$ACTION" in
  up)
    ensure_rule iptables "${IPV4_FORWARD_OUT[@]}"
    ensure_rule iptables "${IPV4_FORWARD_IN[@]}"
    ensure_rule iptables -t nat "${IPV4_NAT[@]}"
    ensure_rule ip6tables "${IPV6_FORWARD_OUT[@]}"
    ensure_rule ip6tables "${IPV6_FORWARD_IN[@]}"
    ensure_rule ip6tables -t nat "${IPV6_NAT[@]}"
    ;;
  down)
    remove_rule iptables "${IPV4_FORWARD_OUT[@]}"
    remove_rule iptables "${IPV4_FORWARD_IN[@]}"
    remove_rule iptables -t nat "${IPV4_NAT[@]}"
    remove_rule ip6tables "${IPV6_FORWARD_OUT[@]}"
    remove_rule ip6tables "${IPV6_FORWARD_IN[@]}"
    remove_rule ip6tables -t nat "${IPV6_NAT[@]}"
    ;;
esac
