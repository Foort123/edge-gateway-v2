# Security

## Credentials and exposure

- ACCESS_UUID is a production Pages secret and a private local value in
  .dev.vars. Never commit real UUIDs or client URLs.
- .env.example contains only a reserved sample UUID; .dev.vars is ignored.
- The VLESS handler validates the configured UUID before opening a socket.
- DNS resolution rejects private, loopback, link-local, multicast, and reserved
  destination addresses before connecting.
- No public ProxyIP pool or external CONNECT proxy is selected automatically.
  The current Pages-only path does not depend on third-party relay credentials.

## Platform and protocol limits

- This project is a VLESS-over-WebSocket TCP gateway, not a full-device VPN.
- DNS UDP port 53 is sent through DoH; other UDP and ICMP are unsupported.
- Cloudflare's production runtime rejected the direct TCP test to
  example.com:443. Ordinary HTTPS browsing and blocked-site access are not
  guaranteed by this Pages-only design.
- The Pages project is currently blocked from new deployments with Cloudflare
  error 8000119. Do not create a duplicate project to bypass the block.

V1 (Foort123/edge-tcp-gateway) is a separate production project and remains
untouched.
