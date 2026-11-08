# Testing

## Automated suite

Run:

    npm test

The Node test suite covers VLESS parsing and UUID authentication, DNS-over-HTTPS
framing and validation, public-address filtering, TCP stream behavior and
socket close cleanup, UDP handling, Pages request routing, and configuration
samples. The suite also verifies that TCP failover races validated public DNS
answers, closes failed and losing sockets, and caps attempts at four addresses.

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

The DNS result and one local HTTP 200 response do not prove this is a usable
general VPN. Production HTTPS remains unverified: the production
`example.com:443` test failed, and the local Wikimedia result does not establish
connectivity to Cloudflare-hosted destinations.

## Local Wrangler verification

Against the Pages Function at V2 commit
`cda30afb00b8d8bab78afe35647e8e99b71eedab`, Wrangler 4.158.0 served it locally
with a test-only UUID. The `/ws` request
upgraded with HTTP 101; the reusable Node WebSocket-to-TLS smoke test sent a
VLESS TCP request to the locally resolved public IPv4 address for
`www.wikipedia.org:443`, completed TLS, and received `HTTP/1.1 200 OK`. This
test is repeatable with `npm run test:e2e:local`; it covers only that local
destination path, not production egress or the gateway's DNS lookup.

With Wrangler 4.158.0, Node.js 22, and a temporary test UUID, the local Pages
Function returned HTTP 200 for `/` and `/ws`, and upgraded VLESS WebSockets with
HTTP 101. Through the VLESS TCP path, an SSH greeting was received from
`ssh.github.com:443`, and a TLS request to the resolved public address for
`www.wikipedia.org` returned `HTTP/1.1 200 OK` (`text/html`). Repeated after
the TCP failover change, the TLS/HTTP check returned 200 again. This confirms
local TCP/TLS/HTTP forwarding to those tested endpoints; it does not confirm
the same result in the deployed production runtime.

A local VLESS UDP DNS query upgraded successfully, but Wrangler's local
`workerd` timed out while fetching Cloudflare DoH. Unit DoH tests pass, and the
earlier production DNS query returned A records. This local network timeout is
not evidence that the deployed DoH path failed.

## Acceptance status

| Requirement | Status | Evidence |
|---|---|---|
| V1 isolation | FAIL | V1 `main` remains at `833bccb0d11c0f16ce6dc14ccd43480e75febaa4` and Pages production remains on deployment `ce58bb86-a6e4-4c6f-8008-7423b7742c14`, but an agent-created branch was pushed to the V1 repository and later deleted without merge or deployment. This violated the prompt's strict no-push rule. |
| V2 architecture documented | PASS | [ARCHITECTURE.md](ARCHITECTURE.md) and [RESEARCH.md](RESEARCH.md) |
| Authentication | PARTIAL | UUID validation and rejection have unit tests; production is still running an older build |
| TCP connectivity | PARTIAL | Unit tests pass; latest local VLESS TLS/HTTP to Wikimedia returned 200 and GitHub SSH returned a banner; production `example.com:443` failed |
| UDP connectivity | PARTIAL | DNS UDP/53 over DoH is implemented and was production-verified; other UDP is dropped |
| DNS | PASS | DoH tests pass; the production VLESS DNS query returned A records |
| Reliability and recovery | PARTIAL | Four-address connect racing, socket cleanup, backpressure, and close behavior have unit coverage; long sessions and reconnect recovery were not tested |
| Security | PARTIAL | UUID authentication, reserved-address filtering, and secret handling have test/review coverage; no external security audit was performed |
| Performance | NOT TESTED | No production web-TCP path verified; no latency, throughput, loss, or endurance measurements |
| Deployment | PARTIAL | Initial independent Pages deployment succeeded; the latest source deployment was rejected with 8000119, and current production still runs the earlier commit |
| Documentation | PARTIAL | Setup and limits are documented, but general-VPN behavior and client end-to-end use remain unverified |

This table separates implementation and unit coverage from production evidence.
See [BENCHMARKS.md](BENCHMARKS.md) before interpreting performance claims.
