import { connect } from "cloudflare:sockets";

const MAX_VLESS_HEADER_BYTES = 1024;
const MAX_CONNECT_HEADER_BYTES = 16 * 1024;
const CONNECT_TIMEOUT_MS = 8000;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);

  if (url.pathname !== "/ws") {
    return next();
  }

  if (request.method !== "GET") {
    return new Response("Method not allowed", {
      status: 405,
      headers: { Allow: "GET" },
    });
  }

  if ((request.headers.get("Upgrade") || "").toLowerCase() !== "websocket") {
    return new Response("WebSocket upgrade required", {
      status: 426,
      headers: { Upgrade: "websocket" },
    });
  }

  const expectedUuid = parseConfiguredUuid(env.ACCESS_UUID);
  if (!expectedUuid) {
    return new Response("Gateway authentication is not configured", {
      status: 503,
    });
  }

  const [client, server] = Object.values(new WebSocketPair());
  server.accept({ allowHalfOpen: true });
  server.binaryType = "arraybuffer";

  let bufferedHeader = new Uint8Array(0);
  let headerParsed = false;
  let socketState = null;
  let socketReader = null;
  let socketWriter = null;
  let messageQueue = Promise.resolve();
  let shuttingDown = false;
  let closeTimer = null;

  const clearCloseTimer = () => {
    if (closeTimer !== null) {
      clearTimeout(closeTimer);
      closeTimer = null;
    }
  };

  const failConnection = async (reason, closeCode = 1011) => {
    if (shuttingDown) return;
    shuttingDown = true;
    clearCloseTimer();

    if (socketState) {
      try {
        await socketState.socket.close();
      } catch {
        // The socket may already be closed.
      }
    }

    if (server.readyState === WebSocket.OPEN) {
      try {
        server.close(closeCode, reason.slice(0, 100));
      } catch {
        // The peer may have closed concurrently.
      }
    }
  };

  server.addEventListener("message", (event) => {
    messageQueue = messageQueue
      .then(async () => {
        const chunk = await toUint8Array(event.data);
        if (chunk.byteLength === 0) return;

        if (!headerParsed) {
          bufferedHeader = concatBytes(bufferedHeader, chunk);
          if (bufferedHeader.byteLength > MAX_VLESS_HEADER_BYTES) {
            throw new Error("VLESS request header is too large");
          }

          const parsed = parseVlessHeader(bufferedHeader);
          if (!parsed) return;

          if (!constantTimeEqual(parsed.uuid, expectedUuid)) {
            throw new AuthenticationError("Unauthorized");
          }

          validateTarget(parsed.target);
          socketState = await connectToTarget(parsed.target, env);
          socketReader = socketState.reader || socketState.readable.getReader();
          socketWriter = socketState.writer || socketState.writable.getWriter();
          headerParsed = true;

          server.send(Uint8Array.of(parsed.version, 0).buffer);
          const initialPayload = bufferedHeader.subarray(parsed.consumed);
          bufferedHeader = new Uint8Array(0);

          void pumpTcpToWebSocket(socketState.prebuffer);
          if (initialPayload.byteLength > 0) {
            await socketWriter.write(initialPayload);
          }
          return;
        }

        if (!socketWriter) {
          throw new Error("Upstream connection is unavailable");
        }
        await socketWriter.write(chunk);
      })
      .catch((error) => {
        const isAuthError = error instanceof AuthenticationError;
        console.error("Gateway connection failed:", error?.message || String(error));
        return failConnection(isAuthError ? "Unauthorized" : "Gateway connection failed", isAuthError ? 1008 : 1011);
      });
  });

  server.addEventListener(
    "close",
    () => {
      if (socketWriter) {
        void socketWriter.close().catch(() => {
          // The writer may already be closed.
        });
      }

      if (socketState && !shuttingDown) {
        closeTimer = setTimeout(() => {
          if (socketState) {
            void socketState.socket.close().catch(() => {
              // The socket may already be closed.
            });
          }
        }, 30000);
      }
    },
    { once: true },
  );

  server.addEventListener(
    "error",
    () => {
      void failConnection("WebSocket error");
    },
    { once: true },
  );

  return new Response(null, {
    status: 101,
    webSocket: client,
  });

  async function pumpTcpToWebSocket(prebuffer) {
    try {
      if (prebuffer?.byteLength && server.readyState === WebSocket.OPEN) {
        server.send(prebuffer.buffer);
      }

      while (true) {
        const { value, done } = await socketReader.read();
        if (done) break;

        if (server.readyState === WebSocket.OPEN) {
          server.send(value.slice().buffer);
        }
      }

      if (server.readyState === WebSocket.OPEN) {
        server.close(1000, "Remote closed");
      }

      if (socketWriter) {
        await socketWriter.close().catch(() => {
          // Half-close or remote EOF may already have closed the writer.
        });
      }
      if (socketState) {
        await socketState.socket.close().catch(() => {
          // The socket may already be closed.
        });
      }
      clearCloseTimer();
    } catch (error) {
      console.error("Upstream stream failed:", error?.message || String(error));
      await failConnection("Upstream stream failed");
    } finally {
      try {
        socketReader?.releaseLock();
      } catch {
        // The reader may already be released.
      }
    }
  }
}

class AuthenticationError extends Error {}

function parseConfiguredUuid(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(normalized)) {
    return null;
  }

  const hex = normalized.replaceAll("-", "");
  const bytes = new Uint8Array(16);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function constantTimeEqual(left, right) {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let i = 0; i < left.byteLength; i += 1) {
    difference |= left[i] ^ right[i];
  }
  return difference === 0;
}

function parseVlessHeader(bytes) {
  if (bytes.byteLength < 1) return null;
  const version = bytes[0];
  if (version !== 0) throw new Error("Unsupported VLESS version");
  if (bytes.byteLength < 18) return null;

  const uuid = bytes.slice(1, 17);
  const addonsLength = bytes[17];
  const commandOffset = 18 + addonsLength;
  if (bytes.byteLength < commandOffset + 4) return null;

  const command = bytes[commandOffset];
  if (command !== 1) {
    throw new Error("Only VLESS TCP requests are supported");
  }

  const port = (bytes[commandOffset + 1] << 8) | bytes[commandOffset + 2];
  if (port < 1 || port > 65535) throw new Error("Invalid destination port");

  const addressType = bytes[commandOffset + 3];
  let offset = commandOffset + 4;
  let host;

  if (addressType === 1) {
    if (bytes.byteLength < offset + 4) return null;
    host = Array.from(bytes.subarray(offset, offset + 4)).join(".");
    offset += 4;
  } else if (addressType === 2) {
    if (bytes.byteLength < offset + 1) return null;
    const domainLength = bytes[offset];
    offset += 1;
    if (domainLength < 1) throw new Error("Empty destination hostname");
    if (bytes.byteLength < offset + domainLength) return null;
    host = textDecoder.decode(bytes.subarray(offset, offset + domainLength));
    offset += domainLength;
  } else if (addressType === 3) {
    if (bytes.byteLength < offset + 16) return null;
    host = ipv6BytesToString(bytes.subarray(offset, offset + 16));
    offset += 16;
  } else {
    throw new Error("Unsupported destination address type");
  }

  return {
    version,
    uuid,
    target: { host, port },
    consumed: offset,
  };
}

function ipv6BytesToString(bytes) {
  const groups = [];
  for (let i = 0; i < 16; i += 2) {
    groups.push(((bytes[i] << 8) | bytes[i + 1]).toString(16));
  }
  return groups.join(":");
}

function validateTarget(target) {
  const host = target.host;
  if (typeof host !== "string" || host.length < 1 || host.length > 253) {
    throw new Error("Invalid destination hostname");
  }

  if (/[\s/\\\x00-\x1f\x7f]/.test(host)) {
    throw new Error("Invalid destination hostname");
  }

  const normalized = host.toLowerCase().replace(/\.$/, "");
  if (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal") ||
    isBlockedIpLiteral(normalized)
  ) {
    throw new Error("Private and local destinations are not allowed");
  }
}

function isBlockedIpLiteral(host) {
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) {
    const parts = host.split(".").map(Number);
    if (parts.some((part) => part < 0 || part > 255)) return true;
    const [a, b] = parts;

    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }

  if (host.includes(":")) {
    return (
      host === "::" ||
      host === "::1" ||
      host.startsWith("fc") ||
      host.startsWith("fd") ||
      /^fe[89ab]/.test(host) ||
      host.startsWith("ff") ||
      host.startsWith("::ffff:") ||
      host.startsWith("2001:db8:")
    );
  }

  return false;
}

async function connectToTarget(target, env) {
  const proxies = parseProxyEndpoints(env.OUTBOUND_PROXY_IP);
  const mode = String(env.OUTBOUND_PROXY_MODE || "fallback").trim().toLowerCase();

  if (mode !== "fallback" && mode !== "always") {
    throw new Error("OUTBOUND_PROXY_MODE must be fallback or always");
  }

  if (mode === "always") {
    if (proxies.length === 0) {
      throw new Error("OUTBOUND_PROXY_IP is required when OUTBOUND_PROXY_MODE is always");
    }
    return openProxyPool(proxies, target, null, env);
  }

  try {
    return await openDirectTarget(target);
  } catch (directError) {
    if (proxies.length === 0) {
      throw new Error("Direct TCP failed; configure OUTBOUND_PROXY_IP with a real HTTP CONNECT proxy");
    }
    return openProxyPool(proxies, target, directError, env);
  }
}

async function openDirectTarget(target) {
  const socket = connect(
    { hostname: target.host, port: target.port },
    { allowHalfOpen: true },
  );

  try {
    await socket.opened;
    return {
      socket,
      readable: socket.readable,
      writable: socket.writable,
    };
  } catch (error) {
    await socket.close().catch(() => {
      // A failed socket may already be closed.
    });
    throw error;
  }
}

function parseProxyEndpoints(value) {
  if (typeof value !== "string" || value.trim() === "") return [];

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const url = new URL(entry.includes("://") ? entry : "http://" + entry);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error("Upstream proxy must use http:// or https://");
      }
      if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
        throw new Error("Set proxy credentials with OUTBOUND_PROXY_USERNAME and OUTBOUND_PROXY_PASSWORD");
      }

      const hostname = url.hostname.replace(/^\[|\]$/g, "");
      const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
      if (!hostname || !Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error("Invalid OUTBOUND_PROXY_IP entry");
      }

      return {
        hostname,
        port,
        secure: url.protocol === "https:",
      };
    });
}

async function openProxyPool(proxies, target, directError, env) {
  const failures = [];
  for (const proxy of proxies) {
    try {
      return await openConnectTunnel(proxy, target, env);
    } catch (error) {
      failures.push(error?.message || String(error));
    }
  }

  const cause = failures.length > 0 ? failures[failures.length - 1] : directError?.message;
  throw new Error("All configured HTTP CONNECT upstreams failed" + (cause ? ": " + cause : ""));
}

async function openConnectTunnel(proxy, target, env) {
  const socket = connect(
    { hostname: proxy.hostname, port: proxy.port },
    {
      secureTransport: proxy.secure ? "on" : "off",
      allowHalfOpen: true,
    },
  );

  let writer;
  let reader;
  try {
    await socket.opened;
    writer = socket.writable.getWriter();
    reader = socket.readable.getReader();

    const authority = formatAuthority(target.host, target.port);
    let request = "CONNECT " + authority + " HTTP/1.1\r\n";
    request += "Host: " + authority + "\r\n";
    request += "Proxy-Connection: Keep-Alive\r\n";

    const username = typeof env.OUTBOUND_PROXY_USERNAME === "string" ? env.OUTBOUND_PROXY_USERNAME : "";
    const password = typeof env.OUTBOUND_PROXY_PASSWORD === "string" ? env.OUTBOUND_PROXY_PASSWORD : "";
    if (username !== "" || password !== "") {
      request += "Proxy-Authorization: Basic " + encodeBasicAuth(username, password) + "\r\n";
    }
    request += "\r\n";

    await writer.write(textEncoder.encode(request));
    const response = await readConnectResponse(reader);
    if (!/^HTTP\/1\.[01] 200(?:\s|$)/i.test(response.header.split("\r\n", 1)[0])) {
      throw new Error("Upstream proxy rejected CONNECT");
    }

    return {
      socket,
      readable: socket.readable,
      writable: socket.writable,
      reader,
      writer,
      prebuffer: response.remainder,
    };
  } catch (error) {
    try {
      reader?.releaseLock();
    } catch {
      // The reader may already be released.
    }
    try {
      writer?.releaseLock();
    } catch {
      // The writer may already be released.
    }
    await socket.close().catch(() => {
      // The socket may already be closed.
    });
    throw error;
  }
}


function formatAuthority(host, port) {
  return (host.includes(":") ? "[" + host + "]" : host) + ":" + port;
}

function encodeBasicAuth(username, password) {
  const bytes = textEncoder.encode(username + ":" + password);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function readConnectResponse(reader) {
  let collected = new Uint8Array(0);
  let timeoutId;

  const readResponse = (async () => {
    while (collected.byteLength <= MAX_CONNECT_HEADER_BYTES) {
      const { value, done } = await reader.read();
      if (done) throw new Error("Upstream closed during CONNECT handshake");

      collected = concatBytes(collected, value);
      const end = findHeaderEnd(collected);
      if (end !== -1) {
        return {
          header: textDecoder.decode(collected.subarray(0, end)),
          remainder: collected.slice(end + 4),
        };
      }
    }
    throw new Error("Upstream CONNECT response header is too large");
  })();

  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error("Upstream CONNECT handshake timed out")), CONNECT_TIMEOUT_MS);
  });

  try {
    return await Promise.race([readResponse, timeout]);
  } finally {
    clearTimeout(timeoutId);
  }
}

function findHeaderEnd(bytes) {
  for (let i = 0; i <= bytes.byteLength - 4; i += 1) {
    if (bytes[i] === 13 && bytes[i + 1] === 10 && bytes[i + 2] === 13 && bytes[i + 3] === 10) {
      return i;
    }
  }
  return -1;
}

function concatBytes(left, right) {
  const result = new Uint8Array(left.byteLength + right.byteLength);
  result.set(left, 0);
  result.set(right, left.byteLength);
  return result;
}

async function toUint8Array(data) {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  if (typeof Blob !== "undefined" && data instanceof Blob) {
    return new Uint8Array(await data.arrayBuffer());
  }
  throw new Error("Only binary WebSocket frames are supported");
}
