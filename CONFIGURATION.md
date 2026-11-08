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

## Outbound proxy configuration

The Pages-only deployment does not use an external HTTP CONNECT proxy or a
public ProxyIP pool. No OUTBOUND_PROXY variables are configured or used.
Adding a separate relay would be a different, hybrid architecture.

## Supported traffic

- TCP destinations that Cloudflare Pages cloudflare:sockets accepts.
- VLESS UDP to port 53, forwarded via Cloudflare DoH.
- Other UDP is discarded while preserving the WebSocket session.

Production testing showed that direct TCP to HTTPS port 443 fails in the
Cloudflare runtime. Do not configure a client profile as a general web VPN.
