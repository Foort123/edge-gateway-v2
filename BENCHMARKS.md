# Benchmarks

**No performance benchmark is claimed.** The current Pages deployment cannot
complete the production TCP test to example.com:443, and the newer code is
not deployed because Cloudflare rejected publication with 8000119.

Unit tests and a successful DNS query are not latency, throughput, packet-loss,
or stability measurements. Do not compare the Pages-only gateway with V1 or
present the prototype as a general web VPN.

If Cloudflare clears the deployment block and a supported non-HTTP TCP
destination is available, record the exact deployment ID, client/version,
network, target/port, date, and test tool. Measure at least three runs of
connection-to-first-response, RTT, transfer throughput, DNS latency, and
reconnect behavior. Exclude UUIDs and complete connection links from reports.
