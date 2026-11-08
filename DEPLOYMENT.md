# Deployment

## Existing Pages project

Project edge-gateway-v2 is a Direct Upload Pages project at
[edge-gateway-v2-5r0.pages.dev](https://edge-gateway-v2-5r0.pages.dev).

- Build command: empty.
- Output directory: public.
- Production secret: ACCESS_UUID.
- Git pushes do not automatically deploy this Direct Upload project.

## Current production state

The latest successful deployment remains
2fadb939-761e-4e9a-9606-d8ed553fbe8d, from commit
f7041f292b09c0e2fa3399416b06f3e0d0ce8991. Its static site returns HTTP 200;
that does not demonstrate that the tunnel works.

Wrangler 4.158.0 compiled the newer Pages Function and uploaded the changed
static asset, but Cloudflare rejected the deployment with error 8000119:
“Your Pages project has been blocked.” The new source is not live. Cloudflare
directed the account owner to abusereply@cloudflare.com; no appeal has been
sent and no duplicate project was created.

Do not retry publication until Cloudflare clears the project block. Do not
create another project to route around it.

## Local development

Create .dev.vars from .env.example, replace the sample UUID with a private
local UUID v4, then run:

    npm exec --yes --package=wrangler@4.158.0 -- wrangler pages dev public

The .dev.vars file is ignored by Git.

## Production deployment after Cloudflare clears the block

Wrangler must be authenticated to the account that owns edge-gateway-v2.
From the repository root:

    npm exec --yes --package=wrangler@4.158.0 -- wrangler pages deploy public --project-name=edge-gateway-v2 --branch=main

Then verify the deployment ID, static page, authenticated DNS query, and TCP
behavior separately. The current production check showed that direct TCP to
example.com:443 fails in the Pages runtime, so do not claim ordinary web
browsing based on the DNS test.

The Pages-only gateway supports DNS UDP/53 over DoH and TCP only where the
runtime permits it. It does not provide arbitrary UDP or ICMP. V1's main branch
and Pages production remain unchanged, but a temporary agent-created V1 branch
was pushed and then deleted without merging or deploying. The strict no-push
requirement was violated; see [TESTING.md](TESTING.md).
