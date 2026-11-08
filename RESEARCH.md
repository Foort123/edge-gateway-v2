# V2 technical research and architecture decision

Date: 2026-11-08  
Constraint confirmed by the owner: deploy only on Cloudflare Pages.

## Findings from primary sources

1. Cloudflare Workers expose outbound TCP through `cloudflare:sockets`, but
   sockets to Cloudflare IP ranges are blocked. Cloudflare says to use `fetch`
   for HTTP requests to ports 80 and 443. A raw VLESS stream cannot be replaced
   by `fetch` without changing its application protocol and handling HTTP
   semantics instead. [TCP sockets](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/)
2. The public protocol matrix lists HTTP/HTTPS and WebSockets as inbound
   protocols; direct inbound TCP from the public Internet is not supported.
   Its TCP `connect()` handler is for service-binding connections between
   Workers. [Supported protocols](https://developers.cloudflare.com/workers/reference/protocols/),
   [Connect handler](https://developers.cloudflare.com/workers/runtime-apis/handlers/connect/)
3. A Worker can accept WebSockets, but the runtime can disconnect long-lived
   connections during updates. A WebSocket message is limited to 32 MiB.
   VLESS-over-WebSocket has no separate client-to-server TCP FIN frame, so the
   implementation treats a WebSocket Close as a full session close, drains
   queued input for a bounded time, and releases the destination socket.
   [WebSockets](https://developers.cloudflare.com/workers/runtime-apis/websockets/)
4. Pages Functions run on the Workers request model and count against Workers
   request quotas. A Pages deployment is still a web application deployment;
   a successful Pages deployment alone does not prove a VPN data plane works.
   [Pages Functions pricing and limits](https://developers.cloudflare.com/pages/functions/pricing/)
5. VLESS carries a destination and TCP/UDP command over its transport; it does
   not create a layer-3 interface by itself. The current project implements the
   VLESS request framing and transports the byte stream over WebSocket.
   [Xray VLESS protocol](https://xtls.github.io/en/development/protocols/vless.html)
6. WireGuard is a layer-3 tunnel that uses a network interface and peer
   configuration, unlike this request/stream-based Pages Function.
   [WireGuard quick start](https://www.wireguard.com/quickstart/)

## Architecture comparison

| Option | What it can deliver | Main limits | Decision |
|---|---|---|---|
| Pages-only VLESS over WebSocket | Authenticated WebSocket ingress, bounded TCP forwarding where `connect()` permits it, and DNS UDP/53 translated to DoH | Not a full-device IP tunnel; no arbitrary outbound UDP/ICMP; HTTP(S) is not a transparent raw TCP path; Cloudflare-address egress is blocked | Selected because the owner restricted deployment to Pages; does not meet the blocked-site browsing requirement in production |
| WireGuard + VLESS fallback on a VPS | Fast layer-3 UDP tunnel plus TCP/TLS fallback for networks that block UDP | Requires a VPS, UDP reachability, OS/service operations, and separate credentials | Best technical match to the original V2 performance goals, but excluded by the Pages-only instruction |
| Single Xray/sing-box server on a VPS | Full TCP and UDP proxying with established client configurations | Requires a VPS and direct server lifecycle/security management | More feasible than Pages for a standalone VPN, but excluded by the Pages-only instruction |
| Cloudflare-managed WARP/Zero Trust | Managed client and Cloudflare-operated network path | Not a custom V2 Pages deployment or a self-hosted VLESS endpoint | Not selected; it changes the product and deployment boundary |

## Selected Pages-only data path

```mermaid
flowchart LR
  C[Hiddify or Xray client] -->|TLS WebSocket /ws + VLESS UUID| F[Pages Function]
  F -->|validate UUID and parse destination| R{VLESS command}
  R -->|TCP| D[DoH hostname lookup and public-IP validation]
  D -->|connect() where runtime permits| T[Public TCP destination]
  T -->|TCP stream| F
  R -->|UDP port 53| H[Cloudflare DoH; Google fallback on error]
  H -->|DNS response wrapped as VLESS UDP| C
  R -->|other UDP| X[Drop datagram; retain WebSocket]
  B[Browser GET] -->|static assets or status page| P[Pages static output]
```

The Function authenticates before it opens a destination socket. TCP is copied
in both directions with backpressure and outbound TCP half-open mode. DNS hostname
resolution filters private and reserved addresses before dialing. DNS payloads
are sent to DoH; non-DNS UDP is dropped. On a transport error the current
session closes and the client must reconnect; there is no server-side session
resume or alternate egress relay.

## Production evidence and decision

The Pages project's previously deployed Function passed a production DNS-over-
HTTPS query. The recorded attempt to connect to `example.com:443` failed with
WebSocket close 1011 and Cloudflare's runtime message directing HTTP traffic to
`fetch`. This is consistent with the documented API boundary above. It does
not prove every non-HTTP TCP destination fails, but it does prove the current
production path is not a verified general web VPN.

The current code is therefore a limited Pages TCP/DNS prototype, not a
production-ready VPN V2. Do not advertise blocked-site access, full-device
coverage, arbitrary UDP, or measured speed. A broader VPN requires changing
the platform constraint or getting Cloudflare to confirm a supported product
path; do not evade the existing project block or use an unapproved relay.

## Unresolved operational gate

Cloudflare rejected the latest Pages deploy with error 8000119 and stated that
the project was blocked. The latest successful deployment still points to
commit `f7041f292b09c0e2fa3399416b06f3e0d0ce8991`; the current GitHub main is
newer. The Cloudflare API does not reveal the cause or list a successful newer
deployment. The account owner has not contacted Cloudflare about the block.

