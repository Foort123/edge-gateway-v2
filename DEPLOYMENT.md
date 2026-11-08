# Deployment

## Create the independent Pages project

1. In Cloudflare Pages, create a project named `edge-gateway-v2` and connect
   the GitHub repository `Foort123/edge-gateway-v2`.
2. Select `main` as the production branch.
3. Leave the build command empty and set the build output directory to
   `public`. There is no build step.
4. Add `ACCESS_UUID` as a **secret text** variable in Production. Generate a
   fresh UUID v4 and keep it out of Git.
5. Save the settings and deploy the latest `main` commit.

The Pages route configuration is in `public/_routes.json`; only `/`, `/ws`, and
`/ws/*` invoke Pages Functions. Other assets are served statically.

## Updates

Push reviewed changes to `main`; Cloudflare Pages builds the production branch
when automatic deployments are enabled. Check the Pages deployment status
before using the endpoint. A static page response only proves the asset deploy,
not that VLESS traffic is working.

## Local development

Run the unit suite with `npm test`. For a Cloudflare-runtime local preview, use
the current Cloudflare Pages local-development instructions for Wrangler and
provide `ACCESS_UUID` as a local secret through an ignored `.dev.vars` file.
Do not commit `.dev.vars`. The `cloudflare:sockets` API and WebSocket upgrade
must be verified in Cloudflare's runtime; Node unit tests use injected fake
sockets and do not emulate the Cloudflare runtime.

## Rollback

In the Cloudflare Pages project, open Deployments and promote the last known
good production deployment. Do not modify or reuse the V1 project during V2
rollback.

## Current deployment status

On 2026-11-08, Cloudflare rejected creating `edge-gateway-v2` with the Git
integration because `Foort123/edge-gateway-v2` is already attached to a Pages
project in a different Cloudflare account (API error `8000093`). The connected
Cloudflare session exposes only the current account, where no V2 Pages project
exists. No V2 project or production secret was created by that failed request.

To keep native Git integration, detach this repository from the other
Cloudflare account first, then retry project creation. A Direct Upload project
is a separate setup choice; Cloudflare's [C3 setup guide](https://developers.cloudflare.com/pages/get-started/c3/)
states that a Direct Upload deployment cannot later be connected to a Git
repository. Do not create that project unless that tradeoff is intended.
