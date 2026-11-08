# Changelog

## V2 VPS-first implementation (in progress)

- Added a dedicated Ubuntu 24.04 amd64 VPS deployment path for WireGuard full
  tunnel plus Xray VLESS REALITY/Vision TCP fallback.
- Pinned Xray-core 26.10.31 and SHA-256 verification for the Linux amd64
  release archive.
- Added a validated Xray config renderer with DoH and private/reserved-address
  deny rules.
- Added root-only server-generated WireGuard/VLESS client profiles, DoT DNS,
  NAT hooks, a health check, and rollback-aware Xray binary updates.
- Updated docs to report that the deployed Pages prototype does not provide
  ordinary web egress. Pages remains a diagnostic project, not the VPN data
  plane.
- VPS and actual client connectivity remain untested until a dedicated VPS is
  provided.

## V2 Pages prototype

- Replaced implicit public ProxyIP fallback with direct TCP and optional,
  explicitly configured HTTP CONNECT.
- Added DoH forwarding for VLESS UDP port 53; other UDP is dropped without
  ending the WebSocket session.
- Added public destination checks, bounded input and DNS responses, stream
  backpressure, TCP half-close, and a modular Node test suite.
