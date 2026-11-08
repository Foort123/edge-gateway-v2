#!/usr/bin/env python3
"""Render the small, auditable Xray server configuration used by VPN V2."""

from __future__ import annotations

import argparse
import ipaddress
import json
import os
import re
import sys
import uuid
from pathlib import Path
from typing import Mapping


PRIVATE_AND_RESERVED_RANGES = [
    "0.0.0.0/8",
    "10.0.0.0/8",
    "100.64.0.0/10",
    "127.0.0.0/8",
    "169.254.0.0/16",
    "172.16.0.0/12",
    "192.0.0.0/24",
    "192.0.2.0/24",
    "192.168.0.0/16",
    "198.18.0.0/15",
    "198.51.100.0/24",
    "203.0.113.0/24",
    "224.0.0.0/4",
    "240.0.0.0/4",
    "255.255.255.255/32",
    "::/128",
    "::1/128",
    "64:ff9b::/96",
    "100::/64",
    "2001:db8::/32",
    "2001::/23",
    "fc00::/7",
    "fe80::/10",
    "ff00::/8",
]

DOMAIN_RE = re.compile(
    r"^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)*"
    r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$"
)
KEY_RE = re.compile(r"^[A-Za-z0-9_-]{43,44}$")


def build_config(values: Mapping[str, str]) -> dict:
    """Validate deployment inputs and return an Xray config with no defaults hidden."""
    user_id = values.get("VLESS_UUID", "")
    try:
        parsed_uuid = uuid.UUID(user_id)
    except (ValueError, AttributeError) as exc:
        raise ValueError("VLESS_UUID must be a UUID v4") from exc
    if parsed_uuid.version != 4 or str(parsed_uuid) != user_id.lower():
        raise ValueError("VLESS_UUID must be a canonical UUID v4")

    private_key = values.get("XRAY_PRIVATE_KEY", "")
    if not KEY_RE.fullmatch(private_key):
        raise ValueError("XRAY_PRIVATE_KEY has an invalid Xray key format")

    reality_target = values.get("REALITY_TARGET", "")
    target_match = re.fullmatch(r"([^:/?#]+):443", reality_target)
    if not target_match:
        raise ValueError("REALITY_TARGET must be a hostname on port 443")
    target_host = target_match.group(1).lower()
    try:
        ipaddress.ip_address(target_host)
    except ValueError:
        pass
    else:
        raise ValueError("REALITY_TARGET must be a DNS hostname, not an IP literal")
    if not DOMAIN_RE.fullmatch(target_host):
        raise ValueError("REALITY_TARGET must contain a valid DNS hostname")

    server_name = values.get("REALITY_SERVER_NAME", target_host).lower()
    if not DOMAIN_RE.fullmatch(server_name) or server_name != target_host:
        raise ValueError("REALITY_SERVER_NAME must match the REALITY_TARGET hostname")

    short_id = values.get("REALITY_SHORT_ID", "")
    if not re.fullmatch(r"[0-9a-fA-F]{16}", short_id):
        raise ValueError("REALITY_SHORT_ID must be 16 hexadecimal characters")

    try:
        port = int(values.get("XRAY_PORT", "443"))
    except ValueError as exc:
        raise ValueError("XRAY_PORT must be an integer") from exc
    if not 1 <= port <= 65535:
        raise ValueError("XRAY_PORT must be between 1 and 65535")

    return {
        "log": {"loglevel": "warning"},
        "dns": {
            "servers": ["https+local://1.1.1.1/dns-query"],
            "queryStrategy": "UseIP",
            "disableCache": False,
        },
        "inbounds": [
            {
                "listen": "0.0.0.0",
                "port": port,
                "protocol": "vless",
                "settings": {
                    "clients": [{"id": str(parsed_uuid), "flow": "xtls-rprx-vision"}],
                    "decryption": "none",
                },
                "streamSettings": {
                    "network": "raw",
                    "security": "reality",
                    "realitySettings": {
                        "show": False,
                        "target": reality_target,
                        "xver": 0,
                        "serverNames": [server_name],
                        "privateKey": private_key,
                        "shortIds": [short_id.lower()],
                    },
                },
            }
        ],
        "outbounds": [
            {"protocol": "freedom", "tag": "direct"},
            {"protocol": "blackhole", "tag": "block"},
        ],
        "routing": {
            "domainStrategy": "IPIfNonMatch",
            "rules": [
                {
                    "type": "field",
                    "ip": PRIVATE_AND_RESERVED_RANGES,
                    "outboundTag": "block",
                }
            ],
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    output = parser.add_mutually_exclusive_group(required=True)
    output.add_argument("--output", type=Path, help="write config to this file with mode 0640")
    output.add_argument("--stdout", action="store_true", help="write JSON to stdout (for tests)")
    args = parser.parse_args()

    try:
        config = build_config(os.environ)
    except ValueError as exc:
        print(f"configuration error: {exc}", file=sys.stderr)
        return 2

    rendered = json.dumps(config, indent=2, sort_keys=True) + "\n"
    if args.stdout:
        sys.stdout.write(rendered)
    else:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        temporary = args.output.with_suffix(args.output.suffix + ".tmp")
        temporary.write_text(rendered, encoding="utf-8")
        temporary.chmod(0o640)
        temporary.replace(args.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
