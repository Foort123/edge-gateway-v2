# Troubleshooting

| Symptom | Likely cause | Check |
| --- | --- | --- |
| Pages site loads but websites fail through VLESS | Pages prototype cannot use raw TCP for ordinary HTTP/S egress on ports 80/443 | Use the VPS WireGuard profile or VLESS fallback. See ARCHITECTURE.md. |
| Xray installer refuses to run | Wrong OS/architecture, an existing VPN config, occupied port, or --ack-fresh-server missing | Use a new Ubuntu Server 24.04 amd64 VPS; inspect its current services before changes. |
| Xray REALITY validation fails | Invalid key/UUID/short ID, unsupported Xray version, or malformed target | Run xray run -test -config /etc/xray/config.json; read journalctl -u xray. |
| Xray service is inactive | Port conflict, bad configuration, missing CAP_NET_BIND_SERVICE, or provider firewall | Run systemctl status xray and journalctl -u xray -n 100. Check the chosen target and listener port. |
| VLESS handshake fails | Wrong UUID, endpoint, Reality public key, SNI, short ID, or client flow | Re-import the generated vless-client-1.txt profile without editing query fields. |
| WireGuard shows no latest handshake | UDP port blocked, endpoint incorrect, or client network blocks UDP | Check UDP port in the VPS provider firewall, endpoint IP/port, and wg show. Try the VLESS TCP fallback. |
| WireGuard connects but no IPv4 traffic works | Forwarding or NAT rules did not load, or provider blocks egress | Run vpn-v2-healthcheck, inspect iptables -S and iptables -t nat -S. Check sysctl net.ipv4.ip_forward. |
| IPv6 sites time out through WireGuard | VPS has no public IPv6 egress | The client routes IPv6 into the tunnel to prevent leakage. Add provider IPv6 egress or use IPv4-only destinations. |
| WireGuard DNS times out | wg0 is down, Unbound failed, or DoT port 853 is blocked | Check systemctl status unbound, journalctl -u unbound, and dig @10.77.0.1 example.com A. |
| Xray DNS lookup fails | Cloudflare DoH unavailable or bad resolver config | Check journalctl -u xray and validate /etc/xray/config.json with xray run -test. |
| Xray update fails to start | New release incompatibility or runtime issue | The updater restores the previous binary. Check journalctl -u xray and rerun the health check. |

Do not attach UUIDs, private keys, pre-shared keys, or complete client profiles
to support requests.
