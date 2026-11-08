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

const ws = new WebSocket(wsUrl);
ws.binaryType = "arraybuffer";
const bridge = new WebSocketDuplex(ws);
let secure;

try {
  await waitForWebSocketOpen(ws);

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
  const status = await readHttpStatus(secure, targetHost, targetPath);
  console.log("Local VLESS E2E: " + targetHost + ":" + targetPort + " -> " + status);
  if (!/^HTTP\/1\.[01] 200\b/.test(status)) process.exitCode = 1;
} finally {
  secure?.destroy();
  if (ws.readyState < WebSocket.CLOSING) ws.close();
}

function waitForWebSocketOpen(socket) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out opening the local WebSocket.")), 10_000);
    socket.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
    socket.addEventListener("error", () => { clearTimeout(timer); reject(new Error("Could not open the local WebSocket.")); }, { once: true });
  });
}

function readHttpStatus(socket, host, path) {
  return new Promise((resolve, reject) => {
    let response = "";
    let finished = false;
    const timer = setTimeout(() => finish(new Error("Timed out awaiting the tunneled HTTPS response.")), 20_000);
    const finish = (error, status) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(status);
    };

    socket.once("secureConnect", () => {
      const request = "GET " + path + " HTTP/1.1\r\nHost: " + host +
        "\r\nUser-Agent: Edge-Gateway-V2 local verification\r\nConnection: close\r\n\r\n";
      socket.write(request);
    });
    socket.on("data", (chunk) => {
      response += chunk.toString("latin1");
      const end = response.indexOf("\r\n");
      if (end >= 0) finish(null, response.slice(0, end));
    });
    socket.once("end", () => finish(new Error("Target closed before returning an HTTP status.")));
    socket.once("error", (error) => finish(error));
  });
}
