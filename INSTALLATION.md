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

## Production

The Pages project is Direct Upload. See DEPLOYMENT.md for its build settings
and deployment status. Cloudflare currently rejects production deployments
of the project with error 8000119; wait for the account owner to appeal and
Cloudflare to clear the block before retrying.

Pages-only limitations: VLESS TCP is available only to destinations allowed by
the Workers socket runtime, DNS UDP/53 uses DoH, and other UDP/ICMP are not
supported. The production TCP test to example.com:443 failed, so this is not
a reliable general web-browsing VPN.
