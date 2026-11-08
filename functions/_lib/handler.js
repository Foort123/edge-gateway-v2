import { parseConfiguredUuid } from "./protocol.js";
import { attachVlessSession } from "./gateway.js";

const BROWSER_INFO = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Edge Gateway V2 — Pages TCP/DNS</title></head><body><main><h1>Edge Gateway V2</h1>
<p>Этот endpoint принимает VLESS поверх WebSocket на <code>/ws</code>.</p>
<p>Состояние конфигурации можно проверить запросом <code>/health</code>; он не проверяет доступность целевых TCP-сайтов.</p>
<p>Поддерживаются DNS UDP/53 через DoH и TCP только к адресам и портам, разрешённым Cloudflare Pages.</p>
<p>Другой UDP и ICMP не поддерживаются. В production прямое TCP-подключение к HTTPS-порту 443 завершилось ошибкой runtime, поэтому обычный веб-трафик не гарантирован.</p></main></body></html>`;

export function createPagesHandler({
  connect,
  fetchImpl = fetch,
  WebSocketPairCtor = globalThis.WebSocketPair,
  upgradeResponse = (client) => new Response(null, { status: 101, webSocket: client }),
  logger = console,
} = {}) {
  return async function onRequest(context) {
    const { request, env = {}, next } = context;
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
      }

      const checks = {
        accessUuidConfigured: parseConfiguredUuid(env.ACCESS_UUID) !== null,
        tcpSocketApiAvailable: typeof connect === "function",
        webSocketPairAvailable: typeof WebSocketPairCtor === "function",
        fetchAvailable: typeof fetchImpl === "function",
      };
      const ready = Object.values(checks).every(Boolean);
      return new Response(request.method === "HEAD" ? null : JSON.stringify({
        service: "edge-gateway-v2",
        status: ready ? "ok" : "not_ready",
        checks,
      }), {
        status: ready ? 200 : 503,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
        },
      });
    }
    if (url.pathname !== "/ws") return next();

    if (request.method !== "GET") {
      return new Response("Method not allowed", { status: 405, headers: { Allow: "GET" } });
    }
    const upgrade = (request.headers.get("upgrade") || "").trim().toLowerCase();
    if (!upgrade) {
      return new Response(BROWSER_INFO, {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
      });
    }
    if (upgrade !== "websocket" || !/(^|,)\s*upgrade\s*(,|$)/i.test(request.headers.get("connection") || "")) {
      return new Response("Invalid WebSocket upgrade", { status: 400 });
    }
    if (!parseConfiguredUuid(env.ACCESS_UUID)) {
      return new Response("Gateway authentication is not configured", { status: 503 });
    }
    if (typeof connect !== "function" || typeof WebSocketPairCtor !== "function") {
      return new Response("WebSocket gateway is unavailable", { status: 503 });
    }

    let pair;
    try {
      pair = new WebSocketPairCtor();
      const client = pair[0] || Object.values(pair)[0];
      const server = pair[1] || Object.values(pair)[1];
      if (!client || !server) throw new Error("WebSocketPair did not return two sockets");
      server.accept();

      attachVlessSession(server, {
        env,
        connect,
        fetchImpl,
        logger,
        waitUntil: (promise) => context.waitUntil?.(promise),
      });
      return upgradeResponse(client);
    } catch (error) {
      logger.error({
        service: "edge-gateway-v2",
        event: "websocket_setup_failed",
        errorType: error instanceof Error ? error.name : "UnknownError",
      });
      return new Response("WebSocket setup failed", { status: 500 });
    }
  };
}
