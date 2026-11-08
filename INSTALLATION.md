# Installation

## Local development and tests

Prerequisites:

- Node.js 20 or newer.
- Python 3 for V2 Xray configuration validation tests.
- Git.

Clone the independent V2 repository and run:

    git clone https://github.com/Foort123/edge-gateway-v2.git
    cd edge-gateway-v2
    npm test

The suite uses Node's built-in test runner and invokes the local Python
configuration renderer. It has no npm runtime dependencies.

## VPS prerequisites

The server installer supports a dedicated, fresh Ubuntu Server 24.04 amd64
host with systemd, a public IPv4 endpoint, working outbound Internet access,
and no active UFW/firewalld/nftables policy. The provider firewall must be
configurable. Do not run it on V1, a shared server, or a host with an existing
WireGuard/Xray deployment.

Xray REALITY needs an operator-selected hostname on TCP 443 as its target. The
hostname must be reachable from the VPS, present a suitable TLS certificate,
and should be in the VPS provider's ASN. Xray sends failed REALITY handshakes
to this target; choosing it incorrectly can expose an unintended forwarder.

## Install on a fresh VPS

Clone the repository on the VPS, then run the installer as root with the VPS's
public endpoint and a provider-appropriate REALITY target:

    sudo bash ops/vps/setup.sh \
      --endpoint <PUBLIC_IPV4_OR_HOSTNAME> \
      --reality-target <HOST_IN_VPS_ASN:443> \
      --ack-fresh-server

Optional flags select the listener ports:

    --xray-port 443
    --wireguard-port 51820

The installer pins Xray-core 26.10.31, verifies the official Linux amd64
archive's SHA-256, generates the VLESS UUID and Xray/WireGuard keys on the VPS,
validates Xray config before startup, and enables services at boot. It does
not change SSH settings or enable a host firewall.

Generated client profiles are written to /root/vpn-v2/clients with mode 0600.
Copy them to an administrator account over SSH using a protected transfer.
Never commit or paste those profiles into logs or chat.

See [CONFIGURATION.md](CONFIGURATION.md) for profile contents and DNS behavior,
and [TESTING.md](TESTING.md) for the production verification that remains.
