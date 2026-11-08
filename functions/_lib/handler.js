import { parseConfiguredUuid } from "./protocol.js";
import { attachVlessSession } from "./gateway.js";

const BROWSER_INFO = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Edge Gateway V2</title></head><body><main><h1>Edge Gateway V2</h1>
<p>This endpoint accepts authenticated VLESS connections over WebSocket at <code>/ws</code>.</p>
<p>Supported traffic: TCP and DNS over HTTPS. Other UDP traffic is not supported.</p></main></body></html>`;

export function createPagesHandler({
  connect,
  fetchImpl = fetch,
  WebSocketPairCtor = globalThis.WebSocketPair,
  upgradeResponse = (client) => new Response(null, { status: 101, webSocket: client }),
} = {}) {
  return async function onRequest(context) {
    const { request, env = {}, next } = context;
    const url = new URL(request.url);
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
        waitUntil: (promise) => context.waitUntil?.(promise),
      });
      return upgradeResponse(client);
    } catch (error) {
      console.error("V2 WebSocket setup failed", error instanceof Error ? error.message : "unknown error");
      return new Response("WebSocket setup failed", { status: 500 });
    }
  };
}
