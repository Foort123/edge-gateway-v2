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

## Production smoke test

After Pages reports a successful production deployment:

1. Open `https://<project>.pages.dev/` and confirm the static page loads.
2. In a VLESS client, use TLS on port 443, WebSocket path `/ws`, and the
   `ACCESS_UUID` secret.
3. Confirm a public TCP HTTPS destination loads through the client.
4. Confirm DNS queries resolve through the VLESS DNS path.
5. Confirm a non-DNS UDP app does not receive service; the WebSocket should
   remain available for TCP traffic.
6. Try a Cloudflare-hosted site and record the result separately; Pages egress
   can block its destination IP range.
7. Reconnect after an interrupted WebSocket and record reconnect time.

Record the date, client version, client network, Pages deployment ID, hostname,
and observed result. Never include the UUID in logs or screenshots.
