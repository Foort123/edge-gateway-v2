# Testing

## Automated suite

Run:

    npm test

The Node test suite covers VLESS parsing and UUID authentication, DNS-over-HTTPS
framing and validation, sequential resolver fallback and Google's 512-byte
wire-format limit, public-address filtering, TCP stream behavior and
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

The same local harness downloaded `/files/10Mb.dat` from `proof.ovh.net` in
three runs; see [BENCHMARKS.md](BENCHMARKS.md) for timings and the test
environment. These measurements are not production performance evidence.

On 2026-11-08, the current local Pages source also passed the reusable TCP smoke
test against `www.wikipedia.org:443` (`HTTP/1.1 200 OK`, 23.3 ms WebSocket open,
220.4 ms TLS ready, 180.8 ms TTFB). It transferred a 122,421-byte response in
198.7 ms; this small response is not a throughput benchmark.

The added `npm run test:e2e:dns` check sent a local VLESS UDP/53 request for
`example.com` through the Pages Function and received a 61-byte DNS response
with two answer records. This verifies the current local DoH route; the script
does not identify which resolver answered. Unit tests separately verify the
Cloudflare-first order and Google's failover behavior.

To repeat both local checks, start `wrangler pages dev` as above, set the same
throwaway UUID in a second PowerShell terminal, then run:

    npm run test:e2e:local
    npm run test:e2e:dns

With Wrangler 4.158.0, Node.js 22, and a temporary test UUID, the local Pages
Function returned HTTP 200 for `/` and `/ws`, and upgraded VLESS WebSockets with
HTTP 101. Through the VLESS TCP path, an SSH greeting was received from
`ssh.github.com:443`, and a TLS request to the resolved public address for
`www.wikipedia.org` returned `HTTP/1.1 200 OK` (`text/html`). Repeated after
the TCP failover change, the TLS/HTTP check returned 200 again. This confirms
local TCP/TLS/HTTP forwarding to those tested endpoints; it does not confirm
the same result in the deployed production runtime.

An earlier local VLESS UDP DNS query timed out while Wrangler's `workerd` was
fetching Cloudflare DoH. After adding sequential resolver fallback, the current
local DNS smoke test returned a valid answer. The test does not show whether
Cloudflare or Google answered, and it does not verify the production runtime.

## Acceptance status

| Requirement | Status | Evidence |
|---|---|---|
| V1 isolation | FAIL | V1 `main` remains at `833bccb0d11c0f16ce6dc14ccd43480e75febaa4` and Pages production remains on deployment `ce58bb86-a6e4-4c6f-8008-7423b7742c14`, but an agent-created branch was pushed to the V1 repository and later deleted without merge or deployment. This violated the prompt's strict no-push rule. |
| V2 architecture documented | PASS | [ARCHITECTURE.md](ARCHITECTURE.md) and [RESEARCH.md](RESEARCH.md) |
| Authentication | PARTIAL | UUID validation and rejection have unit tests; production is still running an older build |
| TCP connectivity | PARTIAL | Unit tests pass; local VLESS TLS/HTTP to Wikimedia and a 10 MiB OVH file returned 200; production `example.com:443` failed |
| UDP connectivity | PARTIAL | DNS UDP/53 over DoH is implemented and was production-verified; other UDP is dropped |
| DNS | PASS | DoH tests pass; the production VLESS DNS query returned A records |
| Reliability and recovery | PARTIAL | Four-address connect racing, socket cleanup, backpressure, and close behavior have unit coverage; long sessions and reconnect recovery were not tested |
| Security | PARTIAL | UUID authentication, reserved-address filtering, and secret handling have test/review coverage; no external security audit was performed |
| Performance | PARTIAL | Three local workerd downloads measured 51.10, 56.47, and 54.51 Mbit/s; production throughput, packet loss, concurrent load, and endurance are not tested |
| Deployment | PARTIAL | Initial independent Pages deployment succeeded; the latest source deployment was rejected with 8000119, and current production still runs the earlier commit |
| Documentation | PARTIAL | Setup and limits are documented, but general-VPN behavior and client end-to-end use remain unverified |

This table separates implementation and unit coverage from production evidence.
See [BENCHMARKS.md](BENCHMARKS.md) before interpreting performance claims.
