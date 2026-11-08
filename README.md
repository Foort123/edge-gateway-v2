# Edge Gateway V2

An independent Cloudflare Pages VLESS-over-WebSocket gateway. The Pages
Function forwards TCP streams with `cloudflare:sockets`; UDP requests to port 53
are sent through Cloudflare DNS-over-HTTPS. Other UDP packets are dropped while
the WebSocket remains open.

This is an application-level proxy, not a full-device IP VPN. It does not carry
arbitrary UDP, ICMP, or other layer-3 traffic. Cloudflare also blocks outbound
TCP sockets to Cloudflare IP ranges, so some Cloudflare-hosted destinations
cannot be reached directly. A configured HTTP CONNECT proxy can be used as an
explicit, separately trusted egress dependency.

## Current status

- Implemented: VLESS TCP, DNS UDP over DoH, safe drop for other UDP, public
  destination checks, bounded WebSocket input, TCP half-close, optional
  operator-configured HTTP CONNECT.
- Unit tested: protocol parsing, authentication, DNS framing and validation,
  TCP direct/fallback paths, session behavior, and Pages request handling.
- Deployment and real-client end-to-end status: see [DEPLOYMENT.md](DEPLOYMENT.md)
  and [TESTING.md](TESTING.md). Do not infer successful tunneling from the
  static landing page.

## Quick start

1. Install Node.js 20 or newer.
2. Run `npm test`.
3. Create a Cloudflare Pages project connected to this repository. Leave the
   build command blank and set the output directory to `public`.
4. Add `ACCESS_UUID` as a secret environment variable for production. Generate
   a UUID locally with `node -e "console.log(crypto.randomUUID())"`; do not
   commit it.
5. Use `wss://<project>.pages.dev/ws` in a VLESS WebSocket client with TLS.

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
