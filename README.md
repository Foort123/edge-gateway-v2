# Edge Gateway V2

An independent Cloudflare Pages VLESS-over-WebSocket prototype. It authenticates
VLESS sessions and sends DNS requests over DoH. Cloudflare Pages can open some
outbound TCP sockets, but its runtime rejects direct socket connections to
HTTP/HTTPS services on ports 80 and 443. A production probe to `example.com:443`
closed with the runtime error “consider using fetch instead”; `fetch` cannot
provide the transparent TLS byte stream a VLESS tunnel needs. As deployed, this
is not a working web-browsing VPN or a solution for blocked websites.

DNS-over-HTTPS was verified through the deployed WebSocket. Other UDP packets
are dropped; arbitrary UDP, ICMP, and layer-3 traffic are unavailable. Normal
web traffic requires a separately trusted HTTP CONNECT egress service on a
reachable port, or a different architecture such as a VPS running WireGuard and
Xray. Some Cloudflare-hosted destinations may also be unreachable directly.

## Current status

- Implemented: VLESS authentication, DNS UDP over DoH, safe drop for other UDP,
  public destination checks, bounded WebSocket input, TCP half-close, and
  optional operator-configured HTTP CONNECT.
- Unit tested: 23 Node tests pass. Wrangler compiled the Pages Function.
- Production verified: landing page returns 200; authenticated VLESS DNS returns
  valid DNS answers. Direct VLESS TCP to HTTPS port 443 is rejected by the Pages
  runtime. See [DEPLOYMENT.md](DEPLOYMENT.md) and [TESTING.md](TESTING.md).

## Quick start

1. Install Node.js 20 or newer.
2. Run `npm test`.
3. The current Pages project is a Direct Upload project, not Git-integrated.
   See [DEPLOYMENT.md](DEPLOYMENT.md) for the Wrangler deployment command.
4. `ACCESS_UUID` is a production secret. Never commit or log it.
5. A VLESS profile can verify authentication and DNS-over-HTTPS, but the current
   Pages-only egress cannot tunnel ordinary HTTP/HTTPS destinations on ports 80
   and 443.

See [INSTALLATION.md](INSTALLATION.md), [CONFIGURATION.md](CONFIGURATION.md),
and [DEPLOYMENT.md](DEPLOYMENT.md) for complete instructions.

## Project layout

- `functions/[[path]].js`: Cloudflare Pages entrypoint.
- `functions/_lib/`: protocol, DNS, outbound TCP, and session modules.
- `public/`: static landing page and Pages route configuration.
- `test/`: Node.js built-in test suite; no third-party packages are required.

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for the accepted scope, packet flow,
platform limits, and alternatives considered. Security assumptions are in
[SECURITY.md](SECURITY.md). Known failures and diagnosis steps are in
[TROUBLESHOOTING.md](TROUBLESHOOTING.md).
