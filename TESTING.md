# Testing

## Automated tests

Install Node.js 20 or newer, then run:

```sh
npm test
```

The built-in `node:test` suite covers VLESS header parsing, UUID comparison,
address restrictions, fragmented and coalesced UDP frames, DoH validation,
DNS resolution filtering, direct TCP, explicit CONNECT fallback, session
behavior, half-close, static requests, and WebSocket setup validation.

## Test evidence categories

- Unit tests use fake sockets and mocked fetch responses.
- No Node test performs a live Cloudflare socket connection.
- A passing test suite is not an end-to-end VPN result.
- A Pages deployment is not an end-to-end result until an actual VLESS client
  authenticates and fetches data through the tunnel.

## Production verification (2026-11-08)

Deployment `2fadb939-761e-4e9a-9606-d8ed553fbe8d` on
`edge-gateway-v2-5r0.pages.dev` was checked:

- `GET /`: HTTP 200, title `Edge Gateway V2`.
- Ordinary `GET /ws`: HTTP 200.
- Valid VLESS UUID over WebSocket: accepted.
- VLESS UDP DNS query for `example.com A`: valid DoH response with two A records;
  the WebSocket stayed open.
- VLESS TCP to `example.com:443`: failed with WebSocket close 1011. The Pages
  runtime log states that direct sockets cannot connect to this HTTP-based
  service and recommends `fetch`.
- Actual website loading through the tunnel: failed/unavailable on the
  Pages-only deployment.
- Invalid production UUID, arbitrary UDP, custom-port TCP, throughput, long
  duration, and reconnect recovery: not tested in production.

The Cloudflare TCP Sockets documentation directs HTTP requests on ports 80 and
443 to `fetch`. That API does not expose the raw TLS stream expected by a
transparent VLESS TCP tunnel. Pages-only therefore cannot meet the browser
traffic goal. A configured trusted HTTP CONNECT egress service on a reachable
port or a VPS data plane is required.

The Node `node:test` suite has 23 passing tests, but uses fake sockets and does
not override this production runtime limitation.

Record the date, client version, client network, Pages deployment ID, hostname,
and observed result. Never include the UUID in logs or screenshots.
