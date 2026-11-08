import {
  AuthenticationError,
  ClientProtocolError,
  VlessDatagramDecoder,
  concatBytes,
  constantTimeEqual,
  frameVlessUdpPacket,
  parseConfiguredUuid,
  parseVlessHeader,
} from "./protocol.js";
import { resolveDnsOverHttps } from "./dns.js";
import { connectToTarget } from "./outbound.js";

const MAX_HEADER_BYTES = 1024;
const MAX_MESSAGE_BYTES = 1024 * 1024;
const MAX_PENDING_BYTES = 1024 * 1024;
const MAX_SOCKET_BUFFERED_AMOUNT = 256 * 1024;
const CLIENT_CLOSE_DRAIN_TIMEOUT_MS = 30_000;

export function attachVlessSession(server, {
  env,
  connect,
  fetchImpl = fetch,
  expectedUuid = parseConfiguredUuid(env.ACCESS_UUID),
  waitUntil = () => {},
}) {
  let headerBytes = new Uint8Array(0);
  let mode = null;
  let socket = null;
  let socketReader = null;
  let socketWriter = null;
  let peerClosed = false;
  let terminated = false;
  let queuedBytes = 0;
  let messageQueue = Promise.resolve();
  let closeTimer = null;
  const datagrams = new VlessDatagramDecoder();

  server.binaryType = "arraybuffer";

  const schedule = (promise) => {
    try {
      waitUntil(promise.catch(() => {}));
    } catch {
      // The event handler itself retains the promise if the platform has no waitUntil hook.
    }
  };

  const releaseLocks = () => {
    try { socketReader?.releaseLock(); } catch {}
    try { socketWriter?.releaseLock(); } catch {}
    socketReader = null;
    socketWriter = null;
  };

  const terminate = async (code, reason, closePeer = true) => {
    if (terminated) return;
    terminated = true;
    if (closeTimer !== null) clearTimeout(closeTimer);
    closeTimer = null;

    if (socket) {
      try { await socket.close(); } catch {}
    }
    releaseLocks();

    if (closePeer && server.readyState === 1) {
      try { server.close(code, String(reason).slice(0, 100)); } catch {}
    }
  };

  const fail = (error) => {
    const code = error instanceof ClientProtocolError ? error.closeCode : 1011;
    const reason = error instanceof AuthenticationError ? "Unauthorized" :
      error instanceof ClientProtocolError ? error.message : "Gateway connection failed";
    if (!(error instanceof AuthenticationError)) {
      console.error("V2 tunnel closed", error instanceof Error ? error.message : "unknown error");
    }
    return terminate(code, reason);
  };

  const enqueueMessage = (event) => {
    const size = messageSize(event.data);
    if (size === null) {
      schedule(fail(new ClientProtocolError("Only binary WebSocket frames are supported", 1003)));
      return;
    }
    if (size > MAX_MESSAGE_BYTES || queuedBytes + size > MAX_PENDING_BYTES) {
      schedule(terminate(1009, "WebSocket buffer limit exceeded"));
      return;
    }

    queuedBytes += size;
    const task = messageQueue
      .then(async () => {
        if (terminated || peerClosed) return;
        const chunk = await toUint8Array(event.data);
        if (chunk.byteLength > 0) await processChunk(chunk);
      })
      .catch(fail)
      .finally(() => { queuedBytes -= size; });
    messageQueue = task;
    schedule(task);
  };

  const processChunk = async (chunk) => {
    if (mode === "tcp") {
      if (!socketWriter) throw new Error("TCP destination is unavailable");
      await socketWriter.write(chunk);
      return;
    }

    if (mode === "udp-drop") return;
    if (mode === "udp-doh") {
      datagrams.push(chunk);
      while (true) {
        const packet = datagrams.nextPacket();
        if (packet === null) break;
        if (packet.byteLength === 0) continue;
        try {
          const answer = await resolveDnsOverHttps(packet, { fetchImpl });
          if (!peerClosed && !terminated && server.readyState === 1) {
            server.send(frameVlessUdpPacket(answer));
          }
        } catch (error) {
          console.error("V2 DoH query failed; dropping DNS response", error instanceof Error ? error.message : "unknown error");
        }
      }
      return;
    }

    headerBytes = concatBytes(headerBytes, chunk);
    const parsed = parseVlessHeader(headerBytes);
    if (!parsed) {
      if (headerBytes.byteLength > MAX_HEADER_BYTES) {
        throw new ClientProtocolError("VLESS request header is too large", 1009);
      }
      return;
    }

    if (!expectedUuid || !constantTimeEqual(parsed.uuid, expectedUuid)) {
      throw new AuthenticationError();
    }

    const initialPayload = headerBytes.slice(parsed.consumed);
    headerBytes = new Uint8Array(0);
    if (parsed.command === 0x01) {
      const connected = await connectToTarget(parsed.target, { connect, fetchImpl });
      if (terminated || peerClosed) {
        await connected.socket.close().catch(() => {});
        return;
      }
      socket = connected.socket;
      socketReader = socket.readable.getReader();
      socketWriter = socket.writable.getWriter();
      mode = "tcp";
      server.send(Uint8Array.of(parsed.version, 0));
      const pump = pumpTcpToWebSocket(connected.prebuffer || new Uint8Array(0));
      schedule(pump);
      if (initialPayload.byteLength > 0) await socketWriter.write(initialPayload);
      return;
    }

    if (parsed.target.port === 53) {
      mode = "udp-doh";
    } else {
      mode = "udp-drop";
    }
    server.send(Uint8Array.of(parsed.version, 0));
    if (mode === "udp-doh" && initialPayload.byteLength > 0) {
      await processChunk(initialPayload);
    }
  };

  const pumpTcpToWebSocket = async (prebuffer) => {
    try {
      if (prebuffer.byteLength > 0 && !(await sendToPeer(prebuffer))) return;
      while (!terminated) {
        const { value, done } = await socketReader.read();
        if (done) break;
        if (!(await sendToPeer(value))) return;
      }
      if (!peerClosed && server.readyState === 1) {
        try { server.close(1000, "Remote closed"); } catch {}
      }
      await terminate(1000, "Remote closed", false);
    } catch (error) {
      if (!terminated) await fail(error);
    }
  };

  const sendToPeer = async (bytes) => {
    while (!terminated && !peerClosed && server.readyState === 1 && server.bufferedAmount > MAX_SOCKET_BUFFERED_AMOUNT) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    if (terminated || peerClosed || server.readyState !== 1) return false;
    server.send(bytes);
    return true;
  };

  server.addEventListener("message", enqueueMessage);
  server.addEventListener("close", () => {
    if (terminated) return;
    peerClosed = true;
    if (closeTimer !== null) clearTimeout(closeTimer);

    closeTimer = setTimeout(() => {
      schedule(terminate(1000, "Client close drain timed out", false));
    }, CLIENT_CLOSE_DRAIN_TIMEOUT_MS);
    const task = messageQueue.then(async () => {
      try { await socketWriter?.close(); } catch {}
      await terminate(1000, "Client closed", false);
    }).catch(() => terminate(1000, "Client closed", false));
    schedule(task);
  }, { once: true });
  server.addEventListener("error", () => { schedule(terminate(1011, "WebSocket error")); }, { once: true });

  return {
    close: () => terminate(1000, "Closed"),
    get mode() { return mode; },
  };
}

function messageSize(data) {
  if (data instanceof ArrayBuffer) return data.byteLength;
  if (ArrayBuffer.isView(data)) return data.byteLength;
  if (typeof Blob !== "undefined" && data instanceof Blob) return data.size;
  return null;
}

async function toUint8Array(data) {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (typeof Blob !== "undefined" && data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
  throw new ClientProtocolError("Only binary WebSocket frames are supported", 1003);
}
