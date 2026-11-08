# Security

## Credential handling

- Pages ACCESS_UUID, the VPS VLESS UUID, Xray REALITY private key, WireGuard
  private keys, and pre-shared keys are separate credentials.
- The VPS installer generates the VPS credentials on the host. It does not
  write them into Git or print their values.
- Client profiles are stored under /root/vpn-v2/clients with mode 0600.
  Xray config is root:xray mode 0640 and contains the VLESS UUID and REALITY
  private key.
- Transfer client profiles over SSH. Do not paste them into issue trackers,
  screenshots, chat, or logs.
- The initial installer creates one WireGuard device profile. Do not reuse it
  on several devices; independent peer provisioning is not implemented yet.

## Network exposure

- Expose only the configured Xray TCP listener and WireGuard UDP listener in
  the provider firewall. DNS port 53 is bound only to the WireGuard interface.
- The installer requires a fresh Ubuntu Server 24.04 amd64 VPS, checks for
  existing wg0/Xray configuration, refuses active UFW, and does not alter SSH
  settings. It does not enable a local firewall; provider firewall rules are
  required.
- Xray runs as the unprivileged xray user with only CAP_NET_BIND_SERVICE.
  systemd applies filesystem and kernel hardening.
- Xray routing blocks private, loopback, link-local, multicast, and reserved IP
  ranges after hostname resolution. DNS resolution uses Xray DoH.
- WireGuard clients use a tunnel resolver. Unbound listens only on tunnel
  addresses and forwards upstream over DNS-over-TLS.

## REALITY target

Xray REALITY forwards unauthenticated handshakes to its configured target.
Choose a reachable TLS host in the VPS provider's ASN, verify its certificate
and SNI, and avoid targets that could expose a general-purpose port-forwarding
service. Do not select a public relay or an unrelated Cloudflare IP as a target.
[Xray's REALITY security guidance](https://xtls.github.io/en/config/transports/reality.html)

## Platform and operational limits

- Pages-only V2 remains a diagnostic prototype. It cannot provide transparent
  TCP egress to ordinary web services on ports 80/443 in the observed runtime.
- WireGuard requires a client network that allows UDP to the VPS.
- Xray fallback is TCP. Use WireGuard for arbitrary UDP and ICMP.
- IPv6 client traffic is routed into WireGuard; if the VPS lacks public IPv6
  egress, it fails closed rather than leaking through the local network.
- Do not infer security or reachability from a passing config test. An actual
  client and VPS end-to-end check is still required.
