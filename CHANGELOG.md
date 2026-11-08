# Changelog

## Unreleased

- Keep Cloudflare DoH as primary and retry resolver errors through Google Public
  DNS; skip Google's wire-format endpoint for DNS messages over 512 bytes.
- Add a repeatable local VLESS UDP/53 end-to-end smoke test and cover resolver
  failover behavior in unit tests.
- Race TCP connects to up to four validated public DNS answers, keep the first
  successful socket, and close the remaining sockets.
- Drain TCP frames already queued before WebSocket close, then close the outbound
  socket with a bounded timeout. Add a regression test for queued-frame draining.
- Ignore Wrangler's generated `_worker.bundle` build artifact.
- Add official-platform research and an explicit acceptance-status table.

## Pages-only scope (2026-11-08)

- The user selected Cloudflare Pages only. The VPS-first scripts and their
  tests were removed from the current source tree.
- Removed optional external HTTP CONNECT fallback settings and code to keep the
  selected data path Pages-only.
- Updated the status page and documentation to describe VLESS TCP plus DNS
  UDP/53 over DoH and the verified Pages port-443 limitation.
- The new Pages production deployment remains blocked by Cloudflare error
  8000119; the prior successful deployment is still live.

## Earlier Pages prototype

- Added VLESS authentication, TCP streaming, DNS-over-HTTPS forwarding for
  UDP/53, bounded input, destination checks, backpressure, half-close, and
  Pages request routing.
- Removed the earlier implicit public ProxyIP fallback.

## Superseded VPS-first experiment

An earlier commit contained an Ubuntu VPS installer for WireGuard and Xray.
Those files were removed after the user selected Cloudflare Pages only. They
remain available in Git history but are not part of the current deployment.
