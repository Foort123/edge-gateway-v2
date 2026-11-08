import test from "node:test";
import assert from "node:assert/strict";
import { resolveDnsOverHttps, resolvePublicAddress } from "../functions/_lib/dns.js";

test("DoH forwards wire-format DNS and validates the matching response", async () => {
  const query = dnsMessage(0x1234, 0x0100);
  const answer = dnsMessage(0x1234, 0x8180);
  let call;
  const fetchImpl = async (url, init) => {
    call = { url: String(url), init };
    return new Response(answer, { headers: { "Content-Type": "application/dns-message" } });
  };

  assert.deepEqual(await resolveDnsOverHttps(query, { fetchImpl }), answer);
  assert.equal(call.url, "https://cloudflare-dns.com/dns-query");
  assert.equal(call.init.method, "POST");
  assert.equal(call.init.redirect, "manual");
  assert.equal(call.init.headers["Content-Type"], "application/dns-message");
  assert.deepEqual(new Uint8Array(call.init.body), query);
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
