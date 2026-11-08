import { resolvePublicAddresses } from "./dns.js";

const CONNECT_TIMEOUT_MS = 8000;
const MAX_CONNECT_ATTEMPTS = 4;

export async function connectToTarget(target, {
  connect,
  fetchImpl = fetch,
  timeoutMs = CONNECT_TIMEOUT_MS,
} = {}) {
  if (typeof connect !== "function") throw new TypeError("A TCP connect function is required");

  const addresses = await resolvePublicAddresses(target.host, target.port, { fetchImpl });
  let lastError;

  for (const hostname of addresses.slice(0, MAX_CONNECT_ATTEMPTS)) {
    let socket;
    let timer;
    try {
      socket = connect({ hostname, port: target.port }, { allowHalfOpen: true });
      await Promise.race([
        socket.opened,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("TCP connect timed out")), timeoutMs);
        }),
      ]);
      return { socket, prebuffer: new Uint8Array(0) };
    } catch (error) {
      lastError = error;
      if (socket) {
        try { await socket.close(); } catch {}
      }
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError || new Error("TCP connection failed for all public destination addresses");
}
