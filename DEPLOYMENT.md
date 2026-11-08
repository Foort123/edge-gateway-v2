# Deployment

## Current Pages project

`edge-gateway-v2` is a Cloudflare Pages **Direct Upload** project at
[`edge-gateway-v2-5r0.pages.dev`](https://edge-gateway-v2-5r0.pages.dev). It was
created separately after Git integration rejected the repository because it is
already attached to a Pages project in another Cloudflare account (API error
`8000093`). Cloudflare documents that Direct Upload projects cannot later be
switched to Git integration. Pushes to GitHub do not deploy this Pages project.

The production build command is empty, the output directory is `public`, and
`ACCESS_UUID` is stored as a Production secret. The project has no external
`OUTBOUND_PROXY_IP` configured.

## Deploy updates

From the repository root, with Wrangler authenticated, run:

```powershell
npm exec --yes --package wrangler@4.158.0 -- wrangler pages deploy public --project-name=edge-gateway-v2 --branch=main
```

The `functions/` directory must remain at the repository root so Wrangler
bundles the Pages Function. Use a narrowly scoped Wrangler login and encrypted
OS keyring storage:

```powershell
npm exec --yes --package wrangler@4.158.0 -- wrangler login --scopes pages:write account:read --use-keyring
```

After deployment, verify the deployment in Pages and use `wrangler logout` when
finished. A static page response alone does not prove tunnel connectivity.

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

Production deployment `2fadb939-761e-4e9a-9606-d8ed553fbe8d` succeeded on
2026-11-08 from commit `f7041f292b09c0e2fa3399416b06f3e0d0ce8991`; Cloudflare
reports `uses_functions: true`.

Production checks:

- `GET /` and ordinary `GET /ws`: HTTP 200.
- Valid VLESS authentication and UDP DNS over DoH: passed; the test query
  returned two A records and kept the WebSocket open.
- VLESS TCP to `example.com:443`: failed. Cloudflare's runtime log reports that
  the target is an HTTP-based service and recommends `fetch` instead. `fetch`
  cannot provide the transparent TLS stream required by VLESS.
- Browser traffic, throughput, long sessions, and reconnect recovery: not
  verified. The deployment is not a functional web-browsing VPN.

This is a Pages-only architecture limit, not a missing deploy setting. To route
web traffic, configure a separately managed, trusted HTTP CONNECT proxy on a
reachable TCP port or move the data plane to the previously selected
VPS-first WireGuard + Xray architecture. Do not use a public relay by default.
