# Benchmarks

## Status

**NOT TESTED.** No V2 deployment or real-client throughput/latency benchmark is
claimed in this repository yet. Do not infer performance from unit tests.

## Repeatable procedure

Record the Cloudflare Pages deployment ID, client and version, operating
system, access network, test destination, date/time, and whether direct or
explicit CONNECT egress was used. Keep UUID values out of recorded output.

Measure at least:

- Time from client connect to the first successful HTTPS response.
- Median and p95 latency over 20 HTTPS requests to a stable public endpoint.
- Download and upload throughput over a fixed-size file, with at least three
  runs per direction.
- Reconnection time after closing the WebSocket.
- Stability of a 30-minute TCP transfer.
- DNS resolution latency over 20 queries.

Report each result with the measurement method and observed failures. Compare
with V1 only using its existing deployment and without changing V1.
