# Testing

## Automated tests

Run:

    npm test

The 25 Node tests cover VLESS parsing and authentication, DNS framing and
validation, private address filtering, direct TCP and explicit CONNECT behavior,
session lifecycle, half-close handling, Pages routing, and the VPS Xray
configuration renderer's positive and negative cases.

## VPS script checks

The installer is not run against a VPS during development. Local checks:

- Xray-core 26.10.31 Windows amd64 binary was downloaded from the official
  GitHub release and its SHA-256 was verified against the official release API.
- The Xray 26.10.31 binary accepted a generated REALITY/Vision server config
  with run -test.
- All four VPS shell scripts pass bash -n using Git Bash.
- No Linux distribution, Docker runtime, or VPS is available locally; wg-quick,
  iptables, Unbound, systemd, and actual WireGuard behavior are not verified.

## Pages production verification (2026-11-08)

Deployment 2fadb939-761e-4e9a-9606-d8ed553fbe8d on
edge-gateway-v2-5r0.pages.dev was checked:

- GET / and ordinary GET /ws returned HTTP 200.
- VLESS UUID authentication succeeded.
- VLESS UDP DNS for example.com A returned two records over DoH and left the
  WebSocket open.
- VLESS TCP to example.com:443 failed with WebSocket close 1011. The runtime
  log states that the HTTP-based socket target should use fetch.
- Browser traffic, throughput, long sessions, invalid UUID behavior in
  production, and reconnect recovery were not verified.

This production check proves the DNS test path only. It does not prove that a
VPN works for ordinary web traffic.

## Required production end-to-end checks

After VPS installation and real client import:

1. Run vpn-v2-healthcheck on the VPS.
2. Connect WireGuard and confirm a latest handshake with wg show.
3. Verify DNS resolves through the tunnel and observe the VPS IPv4/IPv6 egress.
4. Load HTTP and HTTPS sites and transfer a fixed-size file.
5. Verify the Xray VLESS profile independently in Hiddify.
6. Test a UDP application through WireGuard and confirm its public egress.
7. Interrupt and restore each tunnel; record reconnect behavior.
8. Check that IPv6 does not escape the tunnel when server IPv6 is unavailable.

Those end-to-end checks remain NOT TESTED until a VPS endpoint is available.
