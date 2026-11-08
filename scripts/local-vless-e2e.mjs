import { lookup } from "node:dns/promises";
import { Duplex } from "node:stream";
import tls from "node:tls";

const wsUrl = process.env.VLESS_LOCAL_URL || "ws://127.0.0.1:8787/ws";
const targetHost = process.env.E2E_TARGET_HOST || "www.wikipedia.org";
const targetPort = Number(process.env.E2E_TARGET_PORT || 443);
const targetPath = process.env.E2E_TARGET_PATH || "/";
const uuid = process.env.ACCESS_UUID;
const localUrl = new URL(wsUrl);

if (typeof WebSocket !== "function") {
  throw new Error("This smoke test needs Node.js 22.4+ or Node.js 20.10+ with --experimental-websocket.");
}
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid || "")) {
  throw new Error("Set ACCESS_UUID to the same local test UUID used by wrangler pages dev.");
}
if (!Number.isInteger(targetPort) || targetPort < 1 || targetPort > 65535) {
  throw new Error("E2E_TARGET_PORT must be between 1 and 65535.");
}
if (localUrl.protocol !== "ws:" || !["127.0.0.1", "localhost", "[::1]"].includes(localUrl.hostname)) {
  throw new Error("VLESS_LOCAL_URL must point to a local ws:// Pages dev server.");
}
if (/[\r\n]/.test(targetHost) || !targetPath.startsWith("/") || /[\r\n]/.test(targetPath)) {
  throw new Error("E2E target host or path contains invalid characters.");
}

const { address } = await lookup(targetHost, { family: 4 });
const ipBytes = Buffer.from(address.split(".").map(Number));
if (ipBytes.byteLength !== 4) throw new Error("The smoke test needs an IPv4 target.");

class WebSocketDuplex extends Duplex {
  constructor(socket) {
    super();
    this.socket = socket;
    this.waitingForVlessReply = true;
    socket.addEventListener("message", (event) => {
      const bytes = Buffer.from(event.data);
      if (this.waitingForVlessReply) {
        this.waitingForVlessReply = false;
        if (bytes.byteLength < 2 || bytes[0] !== 0 || bytes[1] !== 0) {
          this.destroy(new Error("Unexpected VLESS response header."));
          return;
        }
        if (bytes.byteLength > 2) this.push(bytes.subarray(2));
        return;
      }
      this.push(bytes);
    });
    socket.addEventListener("close", () => this.push(null), { once: true });
    socket.addEventListener("error", () => this.destroy(new Error("WebSocket transport failed.")), { once: true });
  }

  _read() {}

  _write(chunk, _encoding, callback) {
    try {
      if (this.socket.readyState !== WebSocket.OPEN) throw new Error("WebSocket is not open.");
      this.socket.send(chunk);
      callback();
    } catch (error) {
      callback(error);
    }
  }

  _destroy(error, callback) {
    try { if (this.socket.readyState < WebSocket.CLOSING) this.socket.close(); } catch {}
    callback(error);
  }
}

const connectionStartedAt = performance.now();
const ws = new WebSocket(wsUrl);
ws.binaryType = "arraybuffer";
const bridge = new WebSocketDuplex(ws);
let secure;

try {
  const wsOpenedAt = await waitForWebSocketOpen(ws);

  const uuidBytes = Buffer.from(uuid.replaceAll("-", ""), "hex");
  const vlessRequest = Buffer.concat([
    Buffer.from([0]),
    uuidBytes,
    Buffer.from([0, 1, (targetPort >>> 8) & 0xff, targetPort & 0xff, 1]),
    ipBytes,
  ]);
  ws.send(vlessRequest);

  secure = tls.connect({
    socket: bridge,
    servername: targetHost,
    ALPNProtocols: ["http/1.1"],
  });
  const result = await readHttpResponse(secure, targetHost, targetPath, connectionStartedAt, wsOpenedAt);
  const throughput = result.downloadMs > 0
    ? ((result.bodyBytes * 8) / (result.downloadMs * 1000)).toFixed(2) + " Mbit/s"
    : "n/a";
  console.log([
    "Local VLESS E2E:",
    targetHost + ":" + targetPort,
    result.status,
    "ws_open=" + result.wsOpenMs.toFixed(1) + "ms",
    "tls_ready=" + result.tlsReadyMs.toFixed(1) + "ms",
    "ttfb=" + result.ttfbMs.toFixed(1) + "ms",
    "body=" + result.bodyBytes + "B",
    "body_time=" + result.downloadMs.toFixed(1) + "ms",
    "body_rate=" + throughput,
  ].join(" "));
  if (!/^HTTP\/1\.[01] 200\b/.test(result.status)) process.exitCode = 1;
} finally {
  secure?.destroy();
  if (ws.readyState < WebSocket.CLOSING) ws.close();
}

function waitForWebSocketOpen(socket) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out opening the local WebSocket.")), 10_000);
    socket.addEventListener("open", () => { clearTimeout(timer); resolve(performance.now()); }, { once: true });
    socket.addEventListener("error", () => { clearTimeout(timer); reject(new Error("Could not open the local WebSocket.")); }, { once: true });
  });
}

function readHttpResponse(socket, host, path, connectionStartedAt, wsOpenedAt) {
  return new Promise((resolve, reject) => {
    let headerBuffer = Buffer.alloc(0);
    let status = null;
    let expectedBodyBytes = null;
    let bodyBytes = 0;
    let requestSentAt = null;
    let tlsReadyAt = null;
    let firstByteAt = null;
    let bodyStartedAt = null;
    let finished = false;
    const timer = setTimeout(() => finish(new Error("Timed out awaiting the full tunneled HTTPS response.")), 60_000);
    const finish = (error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (error) reject(error);
      else {
        const completedAt = performance.now();
        resolve({
          status,
          bodyBytes,
          wsOpenMs: wsOpenedAt - connectionStartedAt,
          tlsReadyMs: tlsReadyAt - connectionStartedAt,
          ttfbMs: firstByteAt - requestSentAt,
          downloadMs: Math.max(0, completedAt - (bodyStartedAt ?? completedAt)),
        });
      }
    };

    socket.once("secureConnect", () => {
      tlsReadyAt = performance.now();
      requestSentAt = tlsReadyAt;
      const request = "GET " + path + " HTTP/1.1\r\nHost: " + host +
        "\r\nUser-Agent: Edge-Gateway-V2 local verification\r\nAccept-Encoding: identity\r\nConnection: close\r\n\r\n";
      socket.write(request);
    });
    socket.on("data", (chunk) => {
      if (firstByteAt === null) firstByteAt = performance.now();
      if (status === null) {
        headerBuffer = Buffer.concat([headerBuffer, chunk]);
        if (headerBuffer.byteLength > 64 * 1024) {
          finish(new Error("Target response headers exceeded 64 KiB."));
          return;
        }
        const marker = headerBuffer.indexOf("\r\n\r\n");
        if (marker < 0) return;
        const headers = headerBuffer.subarray(0, marker).toString("latin1");
        const firstLineEnd = headers.indexOf("\r\n");
        status = firstLineEnd < 0 ? headers : headers.slice(0, firstLineEnd);
        const contentLength = /(?:^|\r\n)content-length:\s*(\d+)/i.exec(headers);
        expectedBodyBytes = contentLength ? Number(contentLength[1]) : null;
        bodyStartedAt = performance.now();
        const body = headerBuffer.subarray(marker + 4);
        headerBuffer = Buffer.alloc(0);
        addBody(body);
      } else {
        addBody(chunk);
      }
    });
    socket.once("end", () => {
      if (status === null) finish(new Error("Target closed before returning an HTTP response."));
      else if (expectedBodyBytes !== null && bodyBytes < expectedBodyBytes) {
        finish(new Error("Target closed before the declared Content-Length was received."));
      }
      else finish();
    });
    socket.once("error", (error) => finish(error));

    function addBody(chunk) {
      if (chunk.byteLength > 0) {
        if (bodyStartedAt === null) bodyStartedAt = performance.now();
        const remaining = expectedBodyBytes === null ? chunk.byteLength : Math.max(0, expectedBodyBytes - bodyBytes);
        bodyBytes += Math.min(chunk.byteLength, remaining);
      }
      if (expectedBodyBytes !== null && bodyBytes >= expectedBodyBytes) finish();
    }
  });
}
