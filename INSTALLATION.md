# Local development

This repository targets Cloudflare Pages Functions. It does not require a VPS.

## Requirements

- Node.js 20 or newer.
- Wrangler 4.158.0.
- Git.

## Install and run locally

Clone the independent V2 repository:

    git clone https://github.com/Foort123/edge-gateway-v2.git
    cd edge-gateway-v2

Run the test suite:

    npm test

For a local Pages preview, create .dev.vars from .env.example, replace the
sample ACCESS_UUID with a private UUID v4, then run:

    npm exec --yes --package=wrangler@4.158.0 -- wrangler pages dev public

.dev.vars is ignored by Git. Never commit production credentials.

For a repeatable TCP end-to-end smoke test, start the local Pages server with
a throwaway UUID binding, then run `npm run test:e2e:local` in a second
terminal with the same `ACCESS_UUID`. This test uses a locally resolved IPv4
address for `www.wikipedia.org`, establishes TLS inside VLESS-over-WebSocket,
and expects HTTP 200. It requires Node.js 22.4+ (or Node.js 20.10+ with
`--experimental-websocket`) and does not verify production egress or the
gateway's DoH hostname lookup.

## Production

The Pages project is Direct Upload. See DEPLOYMENT.md for its build settings
and deployment status. Cloudflare currently rejects production deployments
of the project with error 8000119; wait for the account owner to appeal and
Cloudflare to clear the block before retrying.

Pages-only limitations: VLESS TCP is available only to destinations allowed by
the Workers socket runtime, DNS UDP/53 uses DoH, and other UDP/ICMP are not
supported. The production TCP test to example.com:443 failed, so this is not
a reliable general web-browsing VPN.
