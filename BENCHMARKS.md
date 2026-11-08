# Benchmarks

**No production performance benchmark is claimed.** The current Pages
deployment cannot complete the recorded production TCP test to
example.com:443, and the newer code is not deployed because Cloudflare rejected
publication with 8000119. A local `workerd` measurement is recorded below; it
is not representative of Cloudflare production or a Hiddify client.

Unit tests and a successful DNS query are not latency, throughput, packet-loss,
or stability measurements. Do not compare the Pages-only gateway with V1 or
present the prototype as a general web VPN.

If Cloudflare clears the deployment block and a supported non-HTTP TCP
destination is available, record the exact deployment ID, client/version,
network, target/port, date, and test tool. Measure at least three runs of
connection-to-first-response, RTT, transfer throughput, DNS latency, and
reconnect behavior. Exclude UUIDs and complete connection links from reports.

## Local Pages/workerd measurement

Measured on 2026-11-08 using V2 source commit
`213b5de8506e9a6fc8b5eba2d9a076e851a76345`, Wrangler 4.158.0, Node.js 22.23.1,
and local `wrangler pages dev` on Windows with compatibility date
`2026-11-08`. The local test used a throwaway UUID and a VLESS request to the
OS-resolved IPv4 address `141.95.207.211`, with TLS SNI `proof.ovh.net`, for
`/files/10Mb.dat` (10,485,760 bytes, HTTP Content-Length). The destination is
not part of the Pages deployment. The test sends an IP literal in the VLESS
header, so it does not measure the gateway's DoH hostname resolution.

| Run | WS open | TLS ready through VLESS | HTTP TTFB | Body time | Bytes | Rate |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 14.8 ms | 205.2 ms | 131.9 ms | 1641.6 ms | 10,485,760 | 51.10 Mbit/s |
| 2 | 16.3 ms | 208.3 ms | 133.0 ms | 1485.4 ms | 10,485,760 | 56.47 Mbit/s |
| 3 | 14.2 ms | 208.8 ms | 133.2 ms | 1539.0 ms | 10,485,760 | 54.51 Mbit/s |
| Median | 14.8 ms | 208.3 ms | 133.0 ms | 1539.0 ms | 10,485,760 | 54.51 Mbit/s |

`TLS ready` is measured from the start of the local WebSocket handshake through
the VLESS TCP connection and TLS handshake to the destination. `TTFB` starts
when the HTTP request is written. `Body time` runs from response headers until
all declared Content-Length bytes have arrived. The rate is decimal Mbit/s
computed from those bytes and body time.

These three runs cover one local machine, one file, and one destination. They
do not measure Cloudflare production, Hiddify, access to Cloudflare-hosted
destinations, upload, packet loss, concurrent load, reconnect time, or long-run
stability. Do not treat this as a general VPN speed claim or compare it with V1.

To repeat, start local Pages dev with a new test-only UUID and set the same
value in a second PowerShell terminal:

    npm exec --yes --package=wrangler@4.158.0 -- wrangler pages dev public --binding=ACCESS_UUID=<test-uuid> --compatibility-date=2026-11-08 --ip=127.0.0.1 --port=8787
    $env:ACCESS_UUID = "<same-test-uuid>"
    $env:E2E_TARGET_HOST = "proof.ovh.net"
    $env:E2E_TARGET_PATH = "/files/10Mb.dat"
    1..3 | ForEach-Object { npm run test:e2e:local }
