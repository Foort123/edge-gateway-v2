# Security

- `ACCESS_UUID` is compared with the 16-byte VLESS UUID and is never logged.
- Malformed commands, headers, address encodings, and credentials are rejected.
- Private, loopback, link-local, multicast, and reserved IP destinations are
  denied. Hostnames are resolved through DoH, and only public A/AAAA records
  are used for direct sockets.
- WebSocket messages and queued bytes are bounded. DNS responses are bounded
  and checked for content type, DNS response bit, and matching transaction ID.
- Outbound HTTP CONNECT is opt-in. The default route is direct TCP; no public
  third-party relay is hard-coded.
- Errors sent to the peer are generic. Logs contain operational error text but
  do not include UUIDs or packet payloads.

Cloudflare-hosted destinations may be blocked by the platform's outbound socket
policy. A configured HTTP CONNECT endpoint is a separate trust boundary and
should be protected, monitored, and updated by its operator. Do not use a
public relay whose operator you cannot trust.

This gateway is not suitable for carrying arbitrary UDP, ICMP, or full-device
VPN traffic. Do not treat the static landing page as an authenticated health
check.
