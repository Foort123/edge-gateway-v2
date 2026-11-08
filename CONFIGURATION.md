# Configuration

## Required Pages variable

| Name | Type | Purpose |
| --- | --- | --- |
| `ACCESS_UUID` | Secret text | UUID v4 used to authenticate VLESS requests. Required in production. |

Set the variable for the **Production** environment. A missing or malformed
value makes `/ws` return HTTP 503 before accepting a WebSocket.

## Optional explicit HTTP CONNECT egress

| Name | Default | Purpose |
| --- | --- | --- |
| `OUTBOUND_PROXY_IP` | unset | Comma-separated `http://host:port` or `https://host:port` CONNECT proxy endpoints. |
| `OUTBOUND_PROXY_MODE` | `fallback` | `fallback` tries direct TCP first; `always` uses a configured proxy. |
| `OUTBOUND_PROXY_USERNAME` | empty | Optional HTTP CONNECT Basic authentication username. |
| `OUTBOUND_PROXY_PASSWORD` | empty | Optional HTTP CONNECT Basic authentication password. |

No third-party proxy is selected automatically. Configure only an endpoint you
operate or trust. The proxy operator can observe destination names, connection
metadata, and unencrypted traffic. The gateway resolves destinations through
DoH and rejects private/reserved answers before connecting.

The legacy `OUTBOUND_PROXY_PROTOCOL` and raw ProxyIP behavior are not used by
V2. Endpoints must implement HTTP CONNECT.

## Client profile

Use these values in a VLESS client:

- Protocol: VLESS
- Address: `<project>.pages.dev` (or the verified custom domain)
- Port: `443`
- UUID: the `ACCESS_UUID` secret
- Transport: WebSocket
- WebSocket path: `/ws`
- TLS: enabled
- SNI / Host: same Pages hostname as the address

DNS requests carried as VLESS UDP to destination port 53 are sent through
Cloudflare DoH. Other UDP destinations are dropped without ending the WebSocket
session. Production testing shows direct TCP sockets to ordinary HTTP/HTTPS
services on ports 80 and 443 are rejected by the Pages runtime. A trusted
HTTP CONNECT proxy must be configured as `OUTBOUND_PROXY_IP` on a reachable TCP
port for ordinary web traffic, or the data plane must run outside Pages.
