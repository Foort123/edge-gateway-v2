# Edge Gateway V2 — Cloudflare Pages

V2 is an independent Pages-only VLESS-over-WebSocket gateway. It supports a
limited TCP proxy path and DNS queries over DNS-over-HTTPS. It is **not a
full-device VPN**.

## Scope and hard limits

- VLESS authentication uses the Pages secret ACCESS_UUID at /ws.
- VLESS TCP can connect only where the Pages socket runtime permits it.
- UDP DNS on port 53 is forwarded through DoH. Other UDP and ICMP are dropped
  or unavailable.
- A production connection to example.com:443 failed with Cloudflare's
  HTTP-based socket restriction. Ordinary HTTPS browsing and access to blocked
  websites therefore do not work reliably in this Pages-only design.
- No VPS, public ProxyIP pool, or external CONNECT proxy is part of the selected
  deployment.

See [RESEARCH.md](RESEARCH.md) for the official platform-source review, the
architecture comparison, and the data-path diagram. The current project is a
limited prototype; the acceptance status and unverified production items are
listed in [TESTING.md](TESTING.md).

## Deployment status

The Direct Upload Pages project is
[edge-gateway-v2-5r0.pages.dev](https://edge-gateway-v2-5r0.pages.dev).
Its latest successful deployment is 2fadb939-761e-4e9a-9606-d8ed553fbe8d
from commit f7041f292b09c0e2fa3399416b06f3e0d0ce8991. Cloudflare rejected the
newer production deploy with error 8000119 (“Your Pages project has been
blocked”). The GitHub source is newer than production; the Pages Function and
updated status page are not live. The account owner has not appealed the block.

## Local development

Requirements: Node.js 20+ and Wrangler 4.158.0.

    npm test
    Copy-Item .env.example .dev.vars
    # Replace the sample ACCESS_UUID with a private UUID v4.
    npm exec --yes --package=wrangler@4.158.0 -- wrangler pages dev public

.dev.vars is ignored by Git. Do not put production credentials in .env.example
or commit local secrets.

After Cloudflare clears the project block, a Direct Upload deploy can be run
with:

    npm exec --yes --package=wrangler@4.158.0 -- wrangler pages deploy public --project-name=edge-gateway-v2 --branch=main

The Pages project uses an empty build command, output directory public, and
the production secret ACCESS_UUID. Log out of Wrangler when finished.

V1 (Foort123/edge-tcp-gateway) is separate and was not changed.
