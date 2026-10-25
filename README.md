# Edge Gateway V2

Cloudflare Pages Function for VLESS over WebSocket with TCP forwarding.

## Pages settings

- Build command: empty
- Build output directory: public
- Pages Function route: /ws
- Production branch: main; pushes trigger a Pages build.

Set ACCESS_UUID as a Pages environment variable (secret text recommended).

## Outbound proxy routing

Cloudflare Workers blocks outbound TCP sockets to Cloudflare IP ranges. The function first attempts a direct TCP connection and falls back when it fails.

By default, the fallback pool uses raw TCP/SNI ProxyIP relays:

- proxyip.fxxk.dedyn.io:443
- proxyip.cmliussss.net:443

These endpoints do not use HTTP CONNECT. The gateway opens a plain TCP socket to each relay and forwards the client's TLS ClientHello unchanged so the relay can route by the destination SNI. This mode is for TLS destinations on port 443.

Configure these Pages variables to override or change the behavior:

- OUTBOUND_PROXY_IP: comma-separated ordered endpoints. For raw ProxyIP mode, use host:port entries. For HTTP CONNECT mode, use http://host:port or https://host:port.
- OUTBOUND_PROXY_PROTOCOL: proxyip (default) or http-connect.
- OUTBOUND_PROXY_MODE: fallback (default, direct first) or always (route every destination through the configured proxy pool).
- OUTBOUND_PROXY_USERNAME and OUTBOUND_PROXY_PASSWORD: optional credentials for HTTP CONNECT proxies.

Public relay availability can change. The relay operator can observe the target SNI and connection metadata. Use only endpoints you trust. Only binary WebSocket frames and VLESS TCP requests are supported.
