#!/usr/bin/env python3
"""Render a VLESS REALITY/Vision share link without printing credentials by default."""

from __future__ import annotations

import argparse
import ipaddress
import os
import re
import sys
import uuid
from pathlib import Path
from urllib.parse import urlencode


DOMAIN_RE = re.compile(
    r"^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)*"
    r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$"
)
KEY_RE = re.compile(r"^[A-Za-z0-9_-]{43,44}$")


def render_profile(values: dict[str, str]) -> str:
    user_id = values.get("VLESS_UUID", "")
    try:
        parsed_uuid = uuid.UUID(user_id)
    except (ValueError, AttributeError) as exc:
        raise ValueError("VLESS_UUID must be a UUID v4") from exc
    if parsed_uuid.version != 4 or str(parsed_uuid) != user_id.lower():
        raise ValueError("VLESS_UUID must be a canonical UUID v4")

    public_key = values.get("XRAY_PUBLIC_KEY", "")
    if not KEY_RE.fullmatch(public_key):
        raise ValueError("XRAY_PUBLIC_KEY has an invalid Xray key format")

    server_name = values.get("REALITY_SERVER_NAME", "").lower()
    if not DOMAIN_RE.fullmatch(server_name):
        raise ValueError("REALITY_SERVER_NAME must be a DNS hostname")

    short_id = values.get("REALITY_SHORT_ID", "")
    if not re.fullmatch(r"[0-9a-fA-F]{16}", short_id):
        raise ValueError("REALITY_SHORT_ID must be 16 hexadecimal characters")

    endpoint = values.get("ENDPOINT", "")
    if endpoint.startswith("[") and endpoint.endswith("]"):
        try:
            ipaddress.IPv6Address(endpoint[1:-1])
        except ValueError as exc:
            raise ValueError("ENDPOINT contains an invalid bracketed IPv6 address") from exc
        endpoint_host = endpoint
    else:
        try:
            ip = ipaddress.ip_address(endpoint)
        except ValueError:
            if not DOMAIN_RE.fullmatch(endpoint):
                raise ValueError("ENDPOINT must be an IP address or DNS hostname")
            endpoint_host = endpoint
        else:
            if isinstance(ip, ipaddress.IPv6Address):
                endpoint_host = f"[{ip.compressed}]"
            else:
                endpoint_host = str(ip)

    try:
        port = int(values.get("XRAY_PORT", "443"))
    except ValueError as exc:
        raise ValueError("XRAY_PORT must be an integer") from exc
    if not 1 <= port <= 65535:
        raise ValueError("XRAY_PORT must be between 1 and 65535")

    query = urlencode(
        {
            "encryption": "none",
            "security": "reality",
            "sni": server_name,
            "fp": "chrome",
            "pbk": public_key,
            "sid": short_id.lower(),
            "spx": "/",
            "type": "tcp",
            "flow": "xtls-rprx-vision",
        }
    )
    return f"vless://{parsed_uuid}@{endpoint_host}:{port}?{query}#Edge-Gateway-V2-Xray"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    output = parser.add_mutually_exclusive_group(required=True)
    output.add_argument("--output", type=Path, help="write profile to a file with mode 0600")
    output.add_argument("--stdout", action="store_true", help="write profile to stdout (for tests)")
    args = parser.parse_args()

    try:
        profile = render_profile(os.environ)
    except ValueError as exc:
        print(f"profile error: {exc}", file=sys.stderr)
        return 2

    if args.stdout:
        sys.stdout.write(profile + "\n")
    else:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(profile + "\n", encoding="utf-8")
        args.output.chmod(0o600)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
