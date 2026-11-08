# Deployment

## Existing Cloudflare Pages diagnostic project

Project edge-gateway-v2 is a Direct Upload Pages project at
[edge-gateway-v2-5r0.pages.dev](https://edge-gateway-v2-5r0.pages.dev).

- Build command: empty.
- Output directory: public.
- ACCESS_UUID: production secret.
- Latest verified deployment: 2fadb939-761e-4e9a-9606-d8ed553fbe8d.
- GitHub pushes do not automatically deploy this project. Cloudflare rejected
  Git integration because the repo is attached to a Pages project in another
  Cloudflare account. Direct Upload cannot later be changed to Git integration.

The Pages project is kept as a diagnostic and DNS prototype. It does not
provide a working browser-traffic tunnel on ports 80/443. See
[Cloudflare TCP sockets](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/).

## VPS requirements

Provision a separate, dedicated Ubuntu Server 24.04 amd64 VPS. The project does
not choose or purchase a provider. Required configuration:

- Stable public IPv4 address; optional public IPv6 egress.
- Provider firewall access.
- Inbound TCP 443 for Xray and UDP 51820 for WireGuard (or the ports selected
  during install).
- Outbound DNS over TLS on TCP 853 and HTTPS on TCP 443.
- No existing wg0, Xray, or active host firewall policy.
- A TLS target hostname selected for the Xray REALITY inbound, reachable from
  the VPS and preferably in the same ASN.

The setup script deliberately refuses to overwrite existing WireGuard/Xray
files and requires --ack-fresh-server. Review it before using it on a host.

## Install

On the fresh VPS:

    git clone https://github.com/Foort123/edge-gateway-v2.git
    cd edge-gateway-v2
    sudo bash ops/vps/setup.sh \
      --endpoint <PUBLIC_IPV4_OR_HOSTNAME> \
      --reality-target <HOST_IN_VPS_ASN:443> \
      --ack-fresh-server

Open the selected TCP and UDP ports in the provider firewall. The script
installs Xray 26.10.31 only after checking the official release SHA-256,
configures systemd services for WireGuard, Unbound, and Xray, and runs the
health check. It generates all credentials on the VPS, not in Git.

The setup creates one client of each type. Move files from
/root/vpn-v2/clients to an administrator account via SSH, then import:
- wireguard-client-1.conf into the WireGuard client.
- vless-client-1.txt into Hiddify as a VLESS share link.

Use WireGuard for the full IP tunnel. The VLESS profile is the TCP fallback.

## Verify

Run on the VPS:

    sudo /usr/local/sbin/vpn-v2-healthcheck
    sudo systemctl status wg-quick@wg0 unbound xray
    sudo wg show wg0

Then test from a real client:

1. Import the WireGuard profile and connect.
2. Check DNS with a query through the tunnel.
3. Check the observed IPv4 and IPv6 egress; the VPS addresses should appear.
4. Load an HTTP and HTTPS site, transfer a fixed-size file, and record latency.
5. Disconnect WireGuard and test the VLESS profile separately in Hiddify.
6. Verify DNS and the observed egress again.
7. Reconnect after an interrupted transfer and record recovery time.

These client and VPS end-to-end checks have not been run yet.

## Safe Xray updates and rollback

The installer puts a verified updater at /usr/local/sbin/vpn-v2-update-xray.
Get the version and SHA-256 from the official Xray GitHub release, then run:

    sudo /usr/local/sbin/vpn-v2-update-xray <version-without-v> <official-sha256>

The updater verifies the archive digest, validates the current config with the
new binary, backs up the current binary, and restores it if the new service
fails to restart. For a full VPS rollback, use the provider snapshot taken
before deployment; do not reuse or modify V1.

## Local Pages deployment

For the existing Direct Upload project, with Wrangler authenticated:

    npm exec --yes --package wrangler@4.158.0 -- wrangler pages deploy public --project-name=edge-gateway-v2 --branch=main

Keep functions/ at the repository root so Wrangler bundles the Pages Function.
After deployment, verify both static assets and VLESS behavior; an HTTP 200 page
alone does not prove a tunnel works. Use wrangler logout when finished.
