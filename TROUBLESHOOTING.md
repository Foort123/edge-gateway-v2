# Troubleshooting

| Symptom | Cause or check |
| --- | --- |
| Static page returns HTTP 200 but tunnel browsing fails | A static response does not test the tunnel. Production TCP to example.com:443 failed in the Pages runtime. |
| WebSocket closes with 1011 on destination port 80 or 443 | The runtime rejected the direct HTTP-based socket. This Pages-only design cannot provide reliable ordinary web browsing. |
| VLESS auth returns 503 | Configure the production Pages secret ACCESS_UUID; use a local UUID in .dev.vars for wrangler pages dev. |
| DNS works but another UDP application fails | Only VLESS UDP port 53 is forwarded through DoH. Other UDP and ICMP are unsupported. |
| Deployment fails with error 8000119 | Cloudflare blocked the Pages project and directed the account owner to abusereply@cloudflare.com. Wait for Cloudflare to clear the block; do not create a duplicate project. |
| New source is in GitHub but old page is live | The project is Direct Upload, so pushes do not deploy it. The latest attempted deployment was blocked; the prior deployment remains live. |

Do not send UUIDs or complete client URLs when requesting support.
