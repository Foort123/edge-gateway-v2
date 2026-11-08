import { resolvePublicAddress } from "./dns.js";

const CONNECT_TIMEOUT_MS = 8000;

export async function connectToTarget(target, {
  connect,
  fetchImpl = fetch,
  timeoutMs = CONNECT_TIMEOUT_MS,
} = {}) {
  if (typeof connect !== "function") throw new TypeError("A TCP connect function is required");

  const hostname = await resolvePublicAddress(target.host, target.port, { fetchImpl });
  const socket = connect({ hostname, port: target.port }, { allowHalfOpen: true });
  let timer;
  try {
    await Promise.race([
      socket.opened,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("TCP connect timed out")), timeoutMs);
      }),
    ]);
    return { socket, prebuffer: new Uint8Array(0) };
  } catch (error) {
    await socket.close().catch(() => {});
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
