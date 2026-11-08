# Troubleshooting

| Symptom | Likely cause | Check |
| --- | --- | --- |
| `/ws` returns 503 | `ACCESS_UUID` is missing or not a UUID | Check the Production secret binding and redeploy. |
| WebSocket closes with policy error | Client UUID does not match the Pages secret | Compare the client profile to the secret without printing either value. |
| TCP connection fails before data | DNS resolution, destination policy, or outbound socket restriction | Check Pages runtime logs; test a public non-Cloudflare destination. |
| A Cloudflare-hosted website closes | Cloudflare blocks outbound sockets to its IP ranges | Use only an explicitly configured trusted HTTP CONNECT proxy or choose a non-Pages egress architecture. |
| DNS lookup times out | DoH endpoint or DNS query problem | Check Pages runtime logs and test a valid DNS query in the client. |
| Non-DNS UDP application has no connectivity | Expected limitation | Pages V2 drops UDP other than port 53. |
| Root page loads but tunnel does not | Static assets and Function data plane are separate | Verify the deployment status and test an actual VLESS client. |
| Large transfer closes | WebSocket message or runtime buffering limit, remote reset, or network release | Check whether the client sends WebSocket messages above 1 MiB and retry after reconnecting. |

Do not place UUIDs, proxy credentials, or payload data in issue reports.
