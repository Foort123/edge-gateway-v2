import { ClientProtocolError, validateTarget } from "./protocol.js";

const DOH_URL = "https://cloudflare-dns.com/dns-query";
const DNS_TIMEOUT_MS = 5000;

export async function resolveDnsOverHttps(query, { fetchImpl = fetch, timeoutMs = DNS_TIMEOUT_MS } = {}) {
  if (!(query instanceof Uint8Array) || query.byteLength < 12 || query.byteLength > 0xffff) {
    throw new ClientProtocolError("Invalid DNS message");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("DNS timeout"), timeoutMs);
  try {
    const response = await fetchImpl(DOH_URL, {
      method: "POST",
      headers: {
        Accept: "application/dns-message",
        "Content-Type": "application/dns-message",
      },
      body: query,
      signal: controller.signal,
      redirect: "manual",
    });

    if (!response.ok) throw new Error(`DoH returned HTTP ${response.status}`);
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.toLowerCase().startsWith("application/dns-message")) {
      throw new Error("DoH returned an unexpected content type");
    }

    const answer = await readBounded(response.body, 0xffff);
    if (
      answer.byteLength < 12 ||
      answer[0] !== query[0] ||
      answer[1] !== query[1] ||
      (answer[2] & 0x80) === 0
    ) {
      throw new Error("DoH returned an invalid DNS response");
    }
    return answer;
  } finally {
    clearTimeout(timer);
  }
}

export async function resolvePublicAddress(host, port, { fetchImpl = fetch, timeoutMs = DNS_TIMEOUT_MS } = {}) {
  if (isIpLiteral(host)) {
    validateTarget({ host, port });
    return host;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("DNS lookup timeout"), timeoutMs);
  try {
    const answers = await Promise.allSettled([
      queryAddress(host, "A", fetchImpl, controller.signal),
      queryAddress(host, "AAAA", fetchImpl, controller.signal),
    ]);
    const addresses = [];
    for (const answer of answers) {
      if (answer.status === "fulfilled") addresses.push(...answer.value);
    }

    const publicAddresses = [];
    for (const address of addresses) {
      try {
        validateTarget({ host: address, port });
        publicAddresses.push(address);
      } catch {
        // Never try private, local, or reserved DNS answers.
      }
    }
    if (publicAddresses.length === 0) throw new Error("Destination has no public A or AAAA address");
    return publicAddresses.find((address) => !address.includes(":")) || publicAddresses[0];
  } finally {
    clearTimeout(timer);
  }
}

async function queryAddress(host, type, fetchImpl, signal) {
  const url = new URL(DOH_URL);
  url.searchParams.set("name", host);
  url.searchParams.set("type", type);

  const response = await fetchImpl(url, {
    headers: { Accept: "application/dns-json" },
    signal,
    redirect: "manual",
  });
  if (!response.ok) throw new Error(`DoH address lookup returned HTTP ${response.status}`);

  const payload = await response.json();
  if (!payload || payload.Status !== 0 || !Array.isArray(payload.Answer)) return [];
  const expectedType = type === "A" ? 1 : 28;
  return payload.Answer
    .filter((record) => record && record.type === expectedType && typeof record.data === "string")
    .map((record) => record.data.trim());
}

async function readBounded(stream, limit) {
  if (!stream) throw new Error("DoH response has no body");
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel("DNS response exceeds the supported size");
        throw new Error("DoH response is too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function isIpLiteral(host) {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.includes(":");
}
