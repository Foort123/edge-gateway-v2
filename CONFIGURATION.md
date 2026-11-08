# Configuration

## Cloudflare Pages diagnostic prototype

The existing Pages project keeps the independent variable:

| Name | Type | Purpose |
| --- | --- | --- |
| ACCESS_UUID | Secret text | VLESS auth for the Pages prototype |

The Pages runtime supports the diagnostic DNS-over-HTTPS flow. Production tests
show direct socket requests to normal HTTP/HTTPS services on ports 80 and 443
fail, so this profile is not a general web proxy.

Optional CONNECT variables OUTBOUND_PROXY_IP, OUTBOUND_PROXY_MODE,
OUTBOUND_PROXY_USERNAME, and OUTBOUND_PROXY_PASSWORD apply only to the Pages
prototype. No third-party relay is selected automatically. Use only an egress
host that you operate or explicitly trust.

## VPS WireGuard profile

The VPS installer creates /root/vpn-v2/clients/wireguard-client-1.conf.
It contains a unique WireGuard private key and pre-shared key, routes IPv4 and
IPv6 through the tunnel, and uses the VPS's Unbound instance for DNS. Treat the
file as a credential. Never reuse the same client profile on multiple devices;
the current installer creates one initial device profile.

- Server listener: UDP 51820 by default.
- Client keepalive: 25 seconds.
- DNS: 10.77.0.1 and fd42:77::1.
- MTU: 1380.

The server forwards IPv4 and IPv6. IPv6 is routed through the tunnel and fails
closed when the VPS has no public IPv6 egress. IPv6-only destinations will then
be unavailable.

## VPS Xray VLESS fallback

The installer creates /root/vpn-v2/clients/vless-client-1.txt for Hiddify or
another Xray-compatible client:

- Protocol: VLESS with REALITY and Vision flow.
- Server address: the public VPS endpoint supplied to setup.sh.
- Port: TCP 443 by default; setup.sh accepts a different TCP port.
- REALITY server name, public key, and short ID: generated or supplied during
  server setup.
- DNS resolution on the server: Xray DoH to Cloudflare 1.1.1.1.
- Stream: TCP. Use WireGuard when you need arbitrary UDP or other IP protocols.

The profile's VLESS UUID is independent from the Pages ACCESS_UUID. The VLESS
UUID and Xray private key are kept in root-owned server configuration; the
client link is a secret and should be shared over an encrypted channel.

The REALITY target and SNI must match. Select a reachable TLS hostname in the
VPS provider's ASN; Xray forwards unauthenticated handshakes to that target.
See [SECURITY.md](SECURITY.md).
