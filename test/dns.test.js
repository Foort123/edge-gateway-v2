import test from "node:test";
import assert from "node:assert/strict";
import { resolveDnsOverHttps, resolvePublicAddress, resolvePublicAddresses } from "../functions/_lib/dns.js";

test("DoH forwards wire-format DNS and validates the matching response", async () => {
  const query = dnsMessage(0x1234, 0x0100);
  const answer = dnsMessage(0x1234, 0x8180);
  let call;
  const calls = [];
  const fetchImpl = async (url, init) => {
    call = { url: String(url), init };
    calls.push(call.url);
    return new Response(answer, { headers: { "Content-Type": "application/dns-message" } });
  };

  assert.deepEqual(await resolveDnsOverHttps(query, { fetchImpl }), answer);
  assert.deepEqual(calls, ["https://cloudflare-dns.com/dns-query"]);
  assert.equal(call.url, "https://cloudflare-dns.com/dns-query");
  assert.equal(call.init.method, "POST");
  assert.equal(call.init.redirect, "manual");
  assert.equal(call.init.headers["Content-Type"], "application/dns-message");
  assert.deepEqual(new Uint8Array(call.init.body), query);
});

test("wire-format DoH uses Google only after Cloudflare fails", async () => {
  const query = dnsMessage(0x2244, 0x0100);
  const answer = dnsMessage(0x2244, 0x8180);
  const calls = [];
  const fetchImpl = async (url, init) => {
    const endpoint = String(url);
    calls.push({ endpoint, init });
    if (endpoint === "https://cloudflare-dns.com/dns-query") {
      return new Response("unavailable", { status: 503 });
    }
    return new Response(answer, { headers: { "Content-Type": "application/dns-message" } });
  };

  assert.deepEqual(await resolveDnsOverHttps(query, { fetchImpl }), answer);
  assert.deepEqual(calls.map((call) => call.endpoint), [
    "https://cloudflare-dns.com/dns-query",
    "https://dns.google/dns-query",
  ]);
  assert.equal(calls[1].init.method, "POST");
  assert.equal(calls[1].init.headers["Content-Type"], "application/dns-message");
  assert.deepEqual(new Uint8Array(calls[1].init.body), query);
});

test("wire-format DoH falls back on SERVFAIL and skips Google for messages above 512 bytes", async () => {
  const query = dnsMessage(0x3344, 0x0100);
  const answer = dnsMessage(0x3344, 0x8180);
  const endpoints = [];
  const fetchImpl = async (url) => {
    const endpoint = String(url);
    endpoints.push(endpoint);
    return endpoint.includes("cloudflare-dns.com")
      ? new Response(dnsMessage(0x3344, 0x8182), { headers: { "Content-Type": "application/dns-message" } })
      : new Response(answer, { headers: { "Content-Type": "application/dns-message" } });
  };

  assert.deepEqual(await resolveDnsOverHttps(query, { fetchImpl }), answer);
  assert.deepEqual(endpoints, [
    "https://cloudflare-dns.com/dns-query",
    "https://dns.google/dns-query",
  ]);

  endpoints.length = 0;
  await assert.rejects(
    resolveDnsOverHttps(new Uint8Array(513), {
      fetchImpl: async (url) => {
        endpoints.push(String(url));
        return new Response("unavailable", { status: 503 });
      },
    }),
    /message limit/,
  );
  assert.deepEqual(endpoints, ["https://cloudflare-dns.com/dns-query"]);
});

test("DoH rejects non-DNS content, wrong transaction IDs, and oversized responses", async () => {
  const query = dnsMessage(0x1000, 0x0100);
  await assert.rejects(
    resolveDnsOverHttps(query, { fetchImpl: async () => new Response("no", { headers: { "Content-Type": "text/plain" } }) }),
    /unexpected content type/,
  );
  await assert.rejects(
    resolveDnsOverHttps(query, { fetchImpl: async () => new Response(null, { status: 302, headers: { Location: "https://attacker.example/" } }) }),
    /HTTP 302/,
  );
  await assert.rejects(
    resolveDnsOverHttps(query, { fetchImpl: async () => new Response(dnsMessage(0x1001, 0x8180), { headers: { "Content-Type": "application/dns-message" } }) }),
    /invalid DNS response/,
  );
  await assert.rejects(
    resolveDnsOverHttps(query, { fetchImpl: async () => new Response(new Uint8Array(0x10000), { headers: { "Content-Type": "application/dns-message" } }) }),
    /too large/,
  );
});

test("public hostname resolution filters private answers and prefers IPv4", async () => {
  const fetchImpl = async (input) => {
    const url = new URL(input);
    const isV4 = url.searchParams.get("type") === "A";
    const answer = isV4
      ? [{ type: 1, data: "93.184.216.34" }]
      : [{ type: 28, data: "2606:4700:4700::1111" }];
    return new Response(JSON.stringify({ Status: 0, Answer: answer }), { headers: { "Content-Type": "application/dns-json" } });
  };
  assert.equal(await resolvePublicAddress("example.com", 443, { fetchImpl }), "93.184.216.34");
});

test("public hostname resolution keeps multiple safe addresses for connection failover", async () => {
  const fetchImpl = async (input) => {
    const url = new URL(input);
    const answer = url.searchParams.get("type") === "A"
      ? [
          { type: 1, data: "10.0.0.7" },
          { type: 1, data: "93.184.216.34" },
          { type: 1, data: "1.1.1.1" },
          { type: 1, data: "93.184.216.34" },
        ]
      : [{ type: 28, data: "2606:4700:4700::1111" }];
    return new Response(JSON.stringify({ Status: 0, Answer: answer }), { headers: { "Content-Type": "application/dns-json" } });
  };

  assert.deepEqual(
    await resolvePublicAddresses("example.com", 443, { fetchImpl }),
    ["93.184.216.34", "1.1.1.1", "2606:4700:4700::1111"],
  );
});

test("public hostname resolution falls back to Google's JSON DoH after Cloudflare fails", async () => {
  const calls = [];
  const fetchImpl = async (input) => {
    const url = new URL(input);
    calls.push(url);
    if (url.hostname === "cloudflare-dns.com") {
      return new Response("unavailable", { status: 503 });
    }

    const isV4 = url.searchParams.get("type") === "A";
    const answer = isV4 ? [{ type: 1, data: "93.184.216.34" }] : [];
    return new Response(JSON.stringify({ Status: 0, Answer: answer }), {
      headers: { "Content-Type": "application/dns-json" },
    });
  };

  assert.equal(await resolvePublicAddress("example.com", 443, { fetchImpl }), "93.184.216.34");
  assert.equal(calls.length, 4);
  assert.ok(calls.every((url) => url.hostname === "cloudflare-dns.com" || url.hostname === "dns.google"));
  assert.ok(calls.some((url) => url.hostname === "dns.google" && url.pathname === "/resolve"));
});

test("public hostname resolution rejects private or missing addresses", async () => {
  const fetchImpl = async (input) => {
    const url = new URL(input);
    const answer = url.searchParams.get("type") === "A" ? [{ type: 1, data: "10.2.3.4" }] : [];
    return new Response(JSON.stringify({ Status: 0, Answer: answer }), { headers: { "Content-Type": "application/dns-json" } });
  };
  await assert.rejects(resolvePublicAddress("internal.example", 80, { fetchImpl }), /no public/);
  await assert.rejects(resolvePublicAddress("127.0.0.1", 80, { fetchImpl }), /Private or reserved/);
});

function dnsMessage(id, flags) {
  return Uint8Array.of(id >>> 8, id & 255, flags >>> 8, flags & 255, 0, 1, 0, 0, 0, 0, 0, 0);
}
