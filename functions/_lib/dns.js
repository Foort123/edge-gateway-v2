import { ClientProtocolError, validateTarget } from "./protocol.js";

const WIRE_DOH_RESOLVERS = [
  { url: "https://cloudflare-dns.com/dns-query" },
  { url: "https://dns.google/dns-query", maxQueryBytes: 512 },
];
const JSON_DOH_RESOLVERS = [
  { url: "https://cloudflare-dns.com/dns-query" },
  { url: "https://dns.google/resolve" },
];
const DNS_TIMEOUT_MS = 5000;

export async function resolveDnsOverHttps(query, { fetchImpl = fetch, timeoutMs = DNS_TIMEOUT_MS } = {}) {
  if (!(query instanceof Uint8Array) || query.byteLength < 12 || query.byteLength > 0xffff) {
    throw new ClientProtocolError("Invalid DNS message");
  }

  return tryResolvers(WIRE_DOH_RESOLVERS, timeoutMs, async (resolver, signal) => {
    if (resolver.maxQueryBytes && query.byteLength > resolver.maxQueryBytes) {
      throw new Error("DNS query exceeds this resolver's message limit");
    }

    const response = await fetchImpl(resolver.url, {
      method: "POST",
      headers: {
        Accept: "application/dns-message",
        "Content-Type": "application/dns-message",
      },
      body: query,
      signal,
      redirect: "manual",
    });

    if (!response.ok) throw new Error(`DoH returned HTTP ${response.status}`);
    const contentType = (response.headers.get("content-type") || "")
      .split(";", 1)[0]
      .trim()
      .toLowerCase();
    if (contentType !== "application/dns-message") {
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
    const responseCode = answer[3] & 0x0f;
    if (responseCode === 2 || responseCode === 5) {
      throw new Error(`DoH returned a retryable DNS status ${responseCode}`);
    }
    return answer;
  });
}

export async function resolvePublicAddress(host, port, { fetchImpl = fetch, timeoutMs = DNS_TIMEOUT_MS } = {}) {
  return (await resolvePublicAddresses(host, port, { fetchImpl, timeoutMs }))[0];
}

export async function resolvePublicAddresses(host, port, { fetchImpl = fetch, timeoutMs = DNS_TIMEOUT_MS } = {}) {
  if (isIpLiteral(host)) {
    validateTarget({ host, port });
    return [host];
  }

  const answers = await Promise.allSettled([
    queryAddress(host, "A", fetchImpl, timeoutMs),
    queryAddress(host, "AAAA", fetchImpl, timeoutMs),
  ]);
  const addresses = [];
  for (const answer of answers) {
    if (answer.status === "fulfilled") addresses.push(...answer.value);
  }

  const publicAddresses = [];
  for (const address of addresses) {
    try {
      validateTarget({ host: address, port });
      if (!publicAddresses.includes(address)) publicAddresses.push(address);
    } catch {
      // Never try private, local, or reserved DNS answers.
    }
  }
  if (publicAddresses.length === 0) throw new Error("Destination has no public A or AAAA address");
  return [
    ...publicAddresses.filter((address) => !address.includes(":")),
    ...publicAddresses.filter((address) => address.includes(":")),
  ];
}

async function queryAddress(host, type, fetchImpl, timeoutMs) {
  return tryResolvers(JSON_DOH_RESOLVERS, timeoutMs, async (resolver, signal) => {
    const url = new URL(resolver.url);
    url.searchParams.set("name", host);
    url.searchParams.set("type", type);

    const response = await fetchImpl(url, {
      headers: { Accept: "application/dns-json" },
      signal,
      redirect: "manual",
    });
    if (!response.ok) throw new Error(`DoH address lookup returned HTTP ${response.status}`);

    const payload = await response.json();
    if (!payload || !Number.isInteger(payload.Status)) {
      throw new Error("DoH address lookup returned invalid JSON");
    }
    if (payload.Status === 2 || payload.Status === 5) {
      throw new Error(`DoH address lookup returned retryable DNS status ${payload.Status}`);
    }
    if (payload.Status !== 0) return [];

    const expectedType = type === "A" ? 1 : 28;
    return (Array.isArray(payload.Answer) ? payload.Answer : [])
      .filter((record) => record && record.type === expectedType && typeof record.data === "string")
      .map((record) => record.data.trim());
  });
}

async function tryResolvers(resolvers, timeoutMs, queryResolver) {
  const attemptTimeoutMs = Math.max(1, Math.floor(timeoutMs / resolvers.length));
  const failures = [];

  for (const resolver of resolvers) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort("DNS resolver timeout"), attemptTimeoutMs);
    try {
      return await queryResolver(resolver, controller.signal);
    } catch (error) {
      failures.push(error);
    } finally {
      clearTimeout(timer);
    }
  }

  const messages = failures.map((error) => error instanceof Error ? error.message : "unknown error");
  throw new AggregateError(failures, `All DoH resolvers failed: ${messages.join("; ")}`);
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
