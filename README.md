# Edge Gateway V2

Cloudflare Pages Function for VLESS over WebSocket with TCP forwarding.

## Pages settings

- Build command: empty
- Build output directory: public
- Pages Function route: /ws
- Production branch: main; pushes trigger a Pages build.

Set ACCESS_UUID as a Pages environment variable (secret text recommended).

## HTTP CONNECT upstream

Cloudflare Workers blocks outbound TCP sockets to Cloudflare IP ranges. To reach destinations hosted behind Cloudflare, configure a real upstream HTTP CONNECT proxy in the Pages environment:

- OUTBOUND_PROXY_IP: one endpoint or a comma-separated ordered pool, such as https://proxy.example.net:8443,http://proxy2.example.net:3128
- OUTBOUND_PROXY_USERNAME and OUTBOUND_PROXY_PASSWORD: optional proxy credentials
- OUTBOUND_PROXY_MODE: fallback (default, direct first) or always (route every destination through the upstream pool)

For https proxy endpoints, the gateway establishes TLS to the proxy before sending CONNECT. The destination TLS ClientHello is then passed through the tunnel unchanged, preserving the client's target SNI.

The public ProxyIP/SNI relay hosts from earlier examples are not HTTP CONNECT services, so they are intentionally not included as default CONNECT endpoints. Supply an upstream you control or have permission to use. Without OUTBOUND_PROXY_IP, the gateway can only connect directly and Cloudflare-hosted destinations may fail.

Only binary WebSocket frames and VLESS TCP requests are supported.
