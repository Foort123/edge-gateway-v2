const wsUrl = process.env.VLESS_LOCAL_URL || "ws://127.0.0.1:8787/ws";
const uuid = process.env.ACCESS_UUID;
const timeoutMs = Number(process.env.DNS_E2E_TIMEOUT_MS || 12_000);

if (typeof WebSocket !== "function") {
  throw new Error("This smoke test needs Node.js 22.4+ or Node.js 20.10+ with --experimental-websocket.");
}
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid || "")) {
  throw new Error("Set ACCESS_UUID to the same local test UUID used by wrangler pages dev.");
}

const localUrl = new URL(wsUrl);
if (localUrl.protocol !== "ws:" || !["127.0.0.1", "localhost", "[::1]"].includes(localUrl.hostname)) {
  throw new Error("VLESS_LOCAL_URL must point to a local ws:// Pages dev server.");
}

const transactionId = crypto.getRandomValues(new Uint8Array(2));
const query = makeDnsQuery(transactionId);
const uuidBytes = Buffer.from(uuid.replaceAll("-", ""), "hex");
const request = Buffer.concat([
  Buffer.from([0]),
  uuidBytes,
  Buffer.from([0, 2, 0, 53, 1, 1, 1, 1, 1]),
  frameUdpPacket(query),
]);

const socket = new WebSocket(wsUrl);
socket.binaryType = "arraybuffer";
let responseHeaderReceived = false;
let streamBuffer = Buffer.alloc(0);

try {
  const answer = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`DNS response timed out after ${timeoutMs}ms`)), timeoutMs);
    socket.addEventListener("open", () => socket.send(request), { once: true });
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("Local VLESS WebSocket failed."));
    }, { once: true });
    socket.addEventListener("close", () => {
      clearTimeout(timer);
      reject(new Error("WebSocket closed before a DNS response arrived."));
    }, { once: true });
    socket.addEventListener("message", (event) => {
      const bytes = Buffer.from(event.data);
      if (!responseHeaderReceived) {
        if (bytes.byteLength < 2 || bytes[0] !== 0 || bytes[1] !== 0) {
          clearTimeout(timer);
          reject(new Error("Unexpected VLESS response header."));
          return;
        }
        responseHeaderReceived = true;
        streamBuffer = Buffer.concat([streamBuffer, bytes.subarray(2)]);
      } else {
        streamBuffer = Buffer.concat([streamBuffer, bytes]);
      }

      if (streamBuffer.byteLength < 2) return;
      const packetLength = streamBuffer.readUInt16BE(0);
      if (streamBuffer.byteLength < packetLength + 2) return;
      clearTimeout(timer);
      resolve(streamBuffer.subarray(2, packetLength + 2));
    });
  });

  if (answer.byteLength < 12 || answer.readUInt16BE(0) !== transactionId[0] * 256 + transactionId[1]) {
    throw new Error("DNS response has an invalid transaction ID or header.");
  }
  if ((answer[2] & 0x80) === 0 || (answer[3] & 0x0f) !== 0) {
    throw new Error(`DNS response is not successful (rcode=${answer[3] & 0x0f}).`);
  }

  console.log([
    "Local VLESS DNS E2E:",
    `id=${answer.readUInt16BE(0)}`,
    `bytes=${answer.byteLength}`,
    `answers=${answer.readUInt16BE(6)}`,
    "resolver=Cloudflare-first/Google-fallback",
  ].join(" "));
} finally {
  if (socket.readyState < WebSocket.CLOSING) socket.close();
}

function makeDnsQuery(id) {
  const name = "example.com".split(".").flatMap((label) => [label.length, ...Buffer.from(label, "ascii")]);
  return Buffer.from([
    id[0], id[1], 0x01, 0x00,
    0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ...name, 0x00, 0x00, 0x01, 0x00, 0x01,
  ]);
}

function frameUdpPacket(packet) {
  const frame = Buffer.allocUnsafe(packet.byteLength + 2);
  frame.writeUInt16BE(packet.byteLength, 0);
  packet.copy(frame, 2);
  return frame;
}
