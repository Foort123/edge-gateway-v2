# Configuration

## Pages environment

| Name | Type | Purpose |
| --- | --- | --- |
| ACCESS_UUID | Secret text | VLESS authentication for /ws |

Set ACCESS_UUID in the Cloudflare Pages production environment. For local
development, put a private UUID v4 in .dev.vars; .dev.vars is ignored by Git.
.env.example contains only a reserved sample UUID.

The VLESS client connects to the Pages hostname over TLS and WebSocket path
/ws. A successful DNS query does not imply that ordinary sites can be
reached through the tunnel.

`GET /health` reports whether `ACCESS_UUID`, `cloudflare:sockets`, the
WebSocket API, and `fetch` are available. A healthy response does not prove
that Cloudflare permits a TCP connection to any particular destination.

## Hiddify / Xray client profile

After Cloudflare clears the project block and the V2 production `ACCESS_UUID`
is known, replace `YOUR-ACCESS-UUID` below with that exact secret and import
the link into Hiddify or an Xray-compatible client:

```text
vless://YOUR-ACCESS-UUID@edge-gateway-v2-5r0.pages.dev:443?encryption=none&security=tls&sni=edge-gateway-v2-5r0.pages.dev&type=ws&host=edge-gateway-v2-5r0.pages.dev&path=%2Fws#Edge-Gateway-V2
```

This is a profile template, not a claim that the blocked project is currently
usable. Even after deployment is cleared, it is only a VLESS TCP/DNS gateway;
ordinary web browsing and access to blocked sites are not guaranteed by Pages.

## Outbound proxy configuration

The Pages-only deployment does not use an external HTTP CONNECT proxy or a
public ProxyIP pool. No OUTBOUND_PROXY variables are configured or used.
Adding a separate relay would be a different, hybrid architecture.

## Supported traffic

- TCP destinations that Cloudflare Pages cloudflare:sockets accepts.
- VLESS UDP to port 53, forwarded via Cloudflare DoH with sequential Google
  Public DNS fallback on resolver errors.
- Other UDP is discarded while preserving the WebSocket session.

The production test to `example.com:443` failed in this Pages runtime. A local
Wrangler TLS test to a non-Cloudflare destination returned HTTP 200, but that
does not verify production HTTPS or connectivity to Cloudflare-hosted sites.
Do not configure a client profile as a general web VPN.
