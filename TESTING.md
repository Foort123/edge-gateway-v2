# Testing

## Automated suite

Run:

    npm test

The Node test suite covers VLESS parsing and UUID authentication, DNS-over-HTTPS
framing and validation, public-address filtering, TCP stream behavior and
half-close, UDP handling, Pages request routing, and configuration samples.

## Production verification

The latest successful deployment is
2fadb939-761e-4e9a-9606-d8ed553fbe8d on
edge-gateway-v2-5r0.pages.dev.

Observed on 2026-11-08:

- / and a normal GET to /ws returned HTTP 200.
- A VLESS UDP DNS query for example.com returned two A records through DoH.
- A VLESS TCP connection to example.com:443 failed with WebSocket close 1011.
  The runtime stated that an HTTP-based socket target should use fetch.
- Browser traffic, Hiddify profile behavior, long sessions, reconnect recovery,
  and useful throughput were not verified.

A later deployment build completed locally, but Cloudflare rejected production
publication with error 8000119 (“Your Pages project has been blocked”). The
new source and diagnostic page are not live. The account owner has not appealed
the block.

The DNS test and HTTP 200 response do not prove this is a usable general VPN.
Ordinary HTTPS traffic is not currently supported by the observed Pages
runtime behavior.
