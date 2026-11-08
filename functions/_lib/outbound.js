import { resolvePublicAddress } from "./dns.js";
import { validateTarget } from "./protocol.js";

const CONNECT_TIMEOUT_MS = 8000;
const CONNECT_HEADER_LIMIT = 16 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export async function connectToTarget(target, env, {
  connect,
  fetchImpl = fetch,
  timeoutMs = CONNECT_TIMEOUT_MS,
} = {}) {
  if (typeof connect !== "function") throw new TypeError("A TCP connect function is required");

  const mode = String(env.OUTBOUND_PROXY_MODE || "fallback").trim().toLowerCase();
  if (mode !== "fallback" && mode !== "always") {
    throw new Error("OUTBOUND_PROXY_MODE must be fallback or always");
  }

  const proxies = parseProxyEndpoints(env.OUTBOUND_PROXY_IP);
  if (mode === "always") {
    if (proxies.length === 0) throw new Error("OUTBOUND_PROXY_IP is required when proxy mode is always");
    const address = await resolvePublicAddress(target.host, target.port, { fetchImpl });
    return openProxyPool(proxies, { ...target, host: address }, env, connect, fetchImpl, timeoutMs);
  }

  const address = await resolvePublicAddress(target.host, target.port, { fetchImpl });
  try {
    const socket = await openSocket({ hostname: address, port: target.port }, connect, timeoutMs);
    return { socket, prebuffer: new Uint8Array(0) };
  } catch (directError) {
    if (proxies.length === 0) {
      throw new Error(`Direct TCP connection failed: ${safeMessage(directError)}`);
    }
    return openProxyPool(proxies, { ...target, host: address }, env, connect, fetchImpl, timeoutMs, directError);
  }
}

function parseProxyEndpoints(value) {
  if (typeof value !== "string" || value.trim() === "") return [];

  return value.split(",").map((entry) => {
    const value = entry.trim();
    if (!value) throw new Error("OUTBOUND_PROXY_IP contains an empty entry");
    const url = new URL(value.includes("://") ? value : `http://${value}`);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("Outbound proxy endpoints must use http:// or https://");
    }
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      throw new Error("Put proxy credentials in OUTBOUND_PROXY_USERNAME and OUTBOUND_PROXY_PASSWORD");
    }

    const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
    validateTarget({ host: hostname, port });
    return { hostname, port, secure: url.protocol === "https:" };
  });
}

async function openProxyPool(proxies, target, env, connect, fetchImpl, timeoutMs, directError) {
  const failures = [];
  for (const proxy of proxies) {
    try {
      await resolvePublicAddress(proxy.hostname, proxy.port, { fetchImpl });
      return await openConnectTunnel(proxy, target, env, connect, timeoutMs);
    } catch (error) {
      failures.push(safeMessage(error));
    }
  }

  const cause = failures.at(-1) || safeMessage(directError);
  throw new Error(`All configured HTTP CONNECT proxies failed${cause ? `: ${cause}` : ""}`);
}

async function openSocket(address, connect, timeoutMs, options = {}) {
  const socket = connect(address, { allowHalfOpen: true, ...options });
  let timer;
  try {
    await Promise.race([
      socket.opened,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("TCP connect timed out")), timeoutMs);
      }),
    ]);
    return socket;
  } catch (error) {
    await socket.close().catch(() => {});
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function openConnectTunnel(proxy, target, env, connect, timeoutMs) {
  const socket = await openSocket(
    { hostname: proxy.hostname, port: proxy.port },
    connect,
    timeoutMs,
    { secureTransport: proxy.secure ? "on" : "off" },
  );

  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();
  try {
    const authority = formatAuthority(target.host, target.port);
    let request = `CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\nProxy-Connection: Keep-Alive\r\n`;
    const username = typeof env.OUTBOUND_PROXY_USERNAME === "string" ? env.OUTBOUND_PROXY_USERNAME : "";
    const password = typeof env.OUTBOUND_PROXY_PASSWORD === "string" ? env.OUTBOUND_PROXY_PASSWORD : "";
    if (username || password) request += `Proxy-Authorization: Basic ${encodeBasicAuth(username, password)}\r\n`;
    request += "\r\n";
    await writer.write(encoder.encode(request));

    const result = await readConnectResponse(reader, timeoutMs);
    if (!/^HTTP\/1\.[01] 200(?:\s|$)/i.test(result.header.split("\r\n", 1)[0])) {
      throw new Error("HTTP CONNECT proxy rejected the tunnel");
    }
    return { socket, prebuffer: result.remainder };
  } catch (error) {
    await socket.close().catch(() => {});
    throw error;
  } finally {
    try { reader.releaseLock(); } catch {}
    try { writer.releaseLock(); } catch {}
  }
}

async function readConnectResponse(reader, timeoutMs) {
  let collected = new Uint8Array(0);
  let timer;
  const read = (async () => {
    while (true) {
      const { value, done } = await reader.read();
      if (done) throw new Error("Proxy closed during CONNECT handshake");
      const next = concatBytes(collected, value);
      const end = findHeaderEnd(next);
      if (end !== -1) {
        if (end > CONNECT_HEADER_LIMIT) throw new Error("HTTP CONNECT response header is too large");
        return { header: decoder.decode(next.subarray(0, end)), remainder: next.slice(end + 4) };
      }
      if (next.byteLength > CONNECT_HEADER_LIMIT) throw new Error("HTTP CONNECT response header is too large");
      collected = next;
    }
  })();

  try {
    return await Promise.race([
      read,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("HTTP CONNECT handshake timed out")), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function findHeaderEnd(bytes) {
  for (let index = 0; index <= bytes.byteLength - 4; index += 1) {
    if (bytes[index] === 13 && bytes[index + 1] === 10 && bytes[index + 2] === 13 && bytes[index + 3] === 10) {
      return index;
    }
  }
  return -1;
}

function formatAuthority(host, port) {
  return `${host.includes(":") ? `[${host}]` : host}:${port}`;
}

function encodeBasicAuth(username, password) {
  let binary = "";
  for (const byte of encoder.encode(`${username}:${password}`)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function concatBytes(left, right) {
  const result = new Uint8Array(left.byteLength + right.byteLength);
  result.set(left);
  result.set(right, left.byteLength);
  return result;
}

function safeMessage(error) {
  return error instanceof Error ? error.message : String(error || "unknown error");
}
