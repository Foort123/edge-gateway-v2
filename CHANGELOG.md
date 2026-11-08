# Changelog

## V2 implementation

- Replaced the implicit public ProxyIP pool with direct TCP and optional,
  explicitly configured HTTP CONNECT.
- Added DoH forwarding for VLESS UDP port 53; other UDP is dropped without
  ending the WebSocket session.
- Added public destination checks, bounded input and DNS responses, stream
  backpressure, TCP half-close, and a modular Node test suite.
