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

## Acceptance status

| Requirement | Status | Evidence |
|---|---|---|
| V1 isolation | PASS | V2 uses a separate repository and Pages project; this work touched only `edge-gateway-v2` |
| V2 architecture documented | PASS | [ARCHITECTURE.md](ARCHITECTURE.md) and [RESEARCH.md](RESEARCH.md) |
| Authentication | PARTIAL | UUID validation and rejection have unit tests; production is still running an older build |
| TCP connectivity | PARTIAL | Stream and half-close unit tests pass; production `example.com:443` failed, and no other live destination was verified |
| UDP connectivity | PARTIAL | DNS UDP/53 over DoH is implemented and was production-verified; other UDP is dropped |
| DNS | PASS | DoH tests pass; the production VLESS DNS query returned A records |
| Reliability and recovery | PARTIAL | Socket cleanup, backpressure, and close behavior have unit coverage; long sessions and reconnect recovery were not tested |
| Security | PARTIAL | UUID authentication, reserved-address filtering, and secret handling have test/review coverage; no external security audit was performed |
| Performance | NOT TESTED | No valid production web-TCP path; no latency, throughput, loss, or endurance measurements |
| Deployment | PARTIAL | Initial independent Pages deployment succeeded; the latest source deployment was rejected with 8000119 |
| Documentation | PARTIAL | Setup and limits are documented, but general-VPN behavior and client end-to-end use remain unverified |

This table separates implementation and unit coverage from production evidence.
See [BENCHMARKS.md](BENCHMARKS.md) before interpreting performance claims.
