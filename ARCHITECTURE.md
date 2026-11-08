# V2 architecture — Cloudflare Pages only

## Selected scope

The user selected Cloudflare Pages only. V2 is a VLESS-over-WebSocket TCP
gateway with a DNS-over-HTTPS path for VLESS UDP port 53. It is not a
WireGuard tunnel or a full-device VPN.

See [RESEARCH.md](RESEARCH.md) for the architecture diagram and comparison of
Pages-only, VPS-based, and managed alternatives.

The Pages Function authenticates the VLESS UUID before opening a TCP socket.
It resolves hostnames through Cloudflare DoH, with sequential Google Public DNS
fallback when the primary response fails, rejects private and reserved
addresses, and races TCP connects to up to four public results. The first
successful socket is kept and the others are closed. It streams TCP in both
directions, applies backpressure, and allows
TCP socket half-open mode. On a client WebSocket Close, the Function drains
already queued input with a bounded timeout, closes the TCP writer, and releases
the socket; a closed WebSocket cannot carry the destination's remaining reply.
DNS wire messages are sent with fetch to Cloudflare DoH and framed back into
VLESS UDP responses. Google is queried only after Cloudflare transport/HTTP or
response errors, including SERVFAIL and REFUSED; Google wire-format requests
are limited to 512 bytes. Non-DNS UDP is dropped without ending the WebSocket
session.

## Runtime limits verified in production

Cloudflare documents outbound TCP sockets and recommends fetch for HTTP
requests to ports 80 and 443. The V2 production test to example.com:443
failed with WebSocket close 1011 and the runtime's HTTP-based socket
restriction. A transparent VLESS TCP stream cannot be replaced by a fetch
request without terminating and changing the client protocol.

Therefore:

- Ordinary HTTP/HTTPS browsing is not supported reliably by this Pages-only
  deployment; blocked-site access is not achieved.
- Arbitrary UDP and ICMP are unavailable through this design.
- Outbound sockets to Cloudflare IP ranges are restricted.
- `GET /health` checks configuration and runtime bindings, not destination
  egress. Structured runtime logs omit UUIDs, destination addresses, and DNS
  payloads; alert delivery is not configured.
- A separate CONNECT server or public relay could add an external hop, but it
  is outside the selected Pages-only architecture and is not configured.
- Do not claim a passing DNS query or an HTTP 200 page proves the gateway works
  as a general VPN.

Sources: [Cloudflare TCP sockets](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/),
[protocol support](https://developers.cloudflare.com/workers/reference/protocols/),
[Cloudflare DoH wire format](https://developers.cloudflare.com/1.1.1.1/encryption/dns-over-https/make-api-requests/dns-wireformat/),
[Google RFC 8484 DoH](https://developers.google.com/speed/public-dns/docs/doh).

## Deployment and isolation

- Pages project: edge-gateway-v2, Direct Upload, output directory public.
- Authentication: production secret ACCESS_UUID.
- Latest successful deployment: 2fadb939-761e-4e9a-9606-d8ed553fbe8d.
- A newer deployment was rejected by Cloudflare with 8000119 (“Your Pages
  project has been blocked”) and is not live. The account owner has not
  appealed this block.
- V1 remains a separate project; its main branch and Pages production were not
  changed. A temporary agent-created branch was pushed to the V1 repository and
  later deleted without merging or deploying. The strict no-push isolation
  criterion was therefore violated; see [TESTING.md](TESTING.md).

The repository no longer includes the previously explored VPS deployment
path; the current implementation follows the user's Pages-only selection.
