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
  const attempts = addresses.slice(0, MAX_CONNECT_ATTEMPTS).map((hostname) => startConnectAttempt(
    hostname,
    target.port,
    connect,
    timeoutMs,
  ));
  const pending = new Set(attempts);
  let lastError;

  while (pending.size > 0) {
    const result = await Promise.race([...pending].map((attempt) => attempt.result));
    pending.delete(result.attempt);
    if (result.error) {
      lastError = result.error;
      await closeAttempt(result.attempt);
      continue;
    }

    await Promise.all([...pending].map(closeAttempt));
    return { socket: result.attempt.socket, prebuffer: new Uint8Array(0) };
  }

  throw lastError || new Error("TCP connection failed for all public destination addresses");
}

function startConnectAttempt(hostname, port, connect, timeoutMs) {
  const attempt = { hostname, socket: null, result: null, timer: null, cancelDeadline: null, settled: false, closed: false };
  try {
    attempt.socket = connect({ hostname, port }, { allowHalfOpen: true });
  } catch (error) {
    attempt.settled = true;
    attempt.result = Promise.resolve({ attempt, error });
    return attempt;
  }

  attempt.result = Promise.race([
    attempt.socket.opened,
    new Promise((_, reject) => {
      attempt.timer = setTimeout(() => reject(new Error("TCP connect timed out")), timeoutMs);
      attempt.cancelDeadline = () => {
        clearTimeout(attempt.timer);
        reject(new Error("TCP connect attempt cancelled"));
      };
    }),
  ]).then(
    () => ({ attempt, error: null }),
    (error) => ({ attempt, error }),
  ).finally(() => {
    attempt.settled = true;
    clearTimeout(attempt.timer);
  });
  return attempt;
}

async function closeAttempt(attempt) {
  if (!attempt.settled && attempt.cancelDeadline) attempt.cancelDeadline();
  else if (attempt.timer !== null) clearTimeout(attempt.timer);
  if (!attempt.socket || attempt.closed) return;
  attempt.closed = true;
  try { await attempt.socket.close(); } catch {}
}
