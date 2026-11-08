# VPN V2

An independent VPN project in a VPS-first rebuild. The Pages Function currently
deployed at edge-gateway-v2-5r0.pages.dev is a diagnostic prototype: DNS over
DoH works, but Cloudflare Pages rejects direct TCP sockets to ordinary HTTP/S
destinations on ports 80 and 443. It is not a working web-browsing VPN.

## Target architecture

- WireGuard on a dedicated Ubuntu Server 24.04 VPS for a full-device IP tunnel
  over UDP. It carries TCP, UDP, DNS, and ICMP when the client network permits
  UDP.
- Xray VLESS + REALITY/Vision on TCP as a fallback when UDP is blocked.
- The Pages project remains an independent static/DNS test surface. It is not
  in the normal traffic path.

This keeps the high-volume path direct to the VPS and avoids an unnecessary
Cloudflare hop. Details and tradeoffs are in [ARCHITECTURE.md](ARCHITECTURE.md).

## Current status

- Pages: deployed independently; DNS over DoH was production-tested. Ordinary
  VLESS TCP to example.com:443 failed in the Pages runtime.
- VPS artifacts: pinned Xray installer, WireGuard/NAT setup, Xray config
  renderer, DoT DNS resolver, health check, and rollback-aware Xray updater are
  in ops/vps.
- Tests: 25 Node tests pass. Xray 26.10.31 accepted the generated server config.
  Bash syntax checks pass.
- VPS runtime and client connectivity: not deployed or tested. A fresh VPS and
  its public endpoint are required before end-to-end verification.

## Quick start

Run the local checks:

    npm test

For VPS installation, use a new Ubuntu Server 24.04 amd64 host and follow
[DEPLOYMENT.md](DEPLOYMENT.md). The installer refuses an existing wg0 or Xray
configuration and requires an explicit fresh-server acknowledgement. It
generates credentials on the VPS; client profiles are root-only files.

Do not reuse production secrets from V1. V1 remains a separate production
project and was not changed.
