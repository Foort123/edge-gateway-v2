# Benchmarks

## Status

**NOT TESTED.** No VPS is provisioned, so there are no valid V2 latency,
throughput, packet-loss, or stability measurements. Unit tests and an Xray
config parse do not imply performance.

## Method

After a VPS and real client are available, record:

- VPS provider, region, CPU, network limit, and IPv4/IPv6 availability.
- Client device, OS, client version, access provider/network, and timestamp.
- WireGuard or VLESS profile, selected port, MTU, and whether the run completed.
- A controlled test endpoint and its region; use the same endpoint for both
  profiles and the direct baseline.

Measure at least three runs per mode:

1. Connection-to-first-response time.
2. Median and p95 RTT over 20 requests.
3. TCP download and upload throughput using a controlled iperf3 endpoint.
4. DNS lookup latency over 20 fresh queries.
5. Packet loss over 100 ICMP probes where the network permits ICMP.
6. Reconnect time after terminating the tunnel.
7. Stability during a 30-minute fixed-size transfer.
8. Server CPU and memory before, during, and after each run.

Compare WireGuard, VLESS fallback, and a direct connection from the same client
network. Never compare against V1 by changing its configuration. Keep UUIDs,
private keys, and full connection URLs out of benchmark files.

## Results

There are no benchmark results yet. Fill in this section only with observed
values and the command/tool used to obtain each measurement.
