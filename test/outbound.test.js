import test from "node:test";
import assert from "node:assert/strict";
import { connectToTarget } from "../functions/_lib/outbound.js";

test("direct TCP resolves hostnames to public addresses and enables half-close", async () => {
  let connected;
  const connect = (address, options) => {
    connected = { address, options };
    return fakeSocket();
  };
  const socket = await connectToTarget(
    { host: "example.com", port: 443 },
    {},
    { connect, fetchImpl: dnsMock({ "example.com": ["93.184.216.34"] }) },
  );

  assert.ok(socket.socket);
  assert.equal(socket.prebuffer.byteLength, 0);
  assert.deepEqual(connected.address, { hostname: "93.184.216.34", port: 443 });
  assert.deepEqual(connected.options, { allowHalfOpen: true });
});

test("a failed direct socket falls back only to an explicitly configured HTTP CONNECT proxy", async () => {
  let directAttempted = false;
  let connectRequest = "";
  let proxyAttempted = false;
  const connect = (address, options) => {
    if (address.hostname === "93.184.216.34") {
      directAttempted = true;
      return fakeSocket(Promise.reject(new Error("direct socket blocked")));
    }
    proxyAttempted = true;
    assert.equal(address.hostname, "relay-gateway.net");
    assert.equal(options.allowHalfOpen, true);
    const readable = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("HTTP/1.1 200 Connection Established\r\n\r\n"));
        controller.close();
      },
    });
    const writable = new WritableStream({ write(chunk) { connectRequest += new TextDecoder().decode(chunk); } });
    return fakeSocket(Promise.resolve(), { readable, writable });
  };

  const result = await connectToTarget(
    { host: "example.com", port: 443 },
    {
      OUTBOUND_PROXY_IP: "http://relay-gateway.net:8080",
      OUTBOUND_PROXY_USERNAME: "u",
      OUTBOUND_PROXY_PASSWORD: "p",
    },
    { connect, fetchImpl: dnsMock({ "example.com": ["93.184.216.34"], "relay-gateway.net": ["93.184.216.35"] }) },
  );

  assert.ok(directAttempted);
  assert.ok(proxyAttempted);
  assert.match(connectRequest, /CONNECT 93\.184\.216\.34:443 HTTP\/1\.1/);
  assert.match(connectRequest, /Proxy-Authorization: Basic dTpw/);
  assert.equal(result.prebuffer.byteLength, 0);
});

test("proxy always mode requires a configured proxy and does not open a direct socket", async () => {
  let attempted = false;
  await assert.rejects(
    connectToTarget({ host: "1.1.1.1", port: 443 }, { OUTBOUND_PROXY_MODE: "always" }, {
      connect: () => { attempted = true; return fakeSocket(); },
    }),
    /OUTBOUND_PROXY_IP is required/,
  );
  assert.equal(attempted, false);
});

test("DNS resolution failure does not bypass destination checks through a proxy", async () => {
  let connectCount = 0;
  await assert.rejects(
    connectToTarget(
      { host: "example.com", port: 443 },
      { OUTBOUND_PROXY_IP: "http://relay-gateway.net:8080" },
      {
        connect: () => { connectCount += 1; return fakeSocket(); },
        fetchImpl: async () => new Response(JSON.stringify({ Status: 3, Answer: [] }), { headers: { "Content-Type": "application/dns-json" } }),
      },
    ),
    /no public/,
  );
  assert.equal(connectCount, 0);
});

test("malformed proxy endpoints and invalid modes are rejected", async () => {
  const connect = () => fakeSocket();
  await assert.rejects(
    connectToTarget({ host: "1.1.1.1", port: 443 }, { OUTBOUND_PROXY_MODE: "fast" }, { connect }),
    /must be fallback or always/,
  );
  await assert.rejects(
    connectToTarget({ host: "1.1.1.1", port: 443 }, { OUTBOUND_PROXY_IP: "file://relay.example" }, { connect }),
    /must use http/,
  );
});

function fakeSocket(opened = Promise.resolve(), streams = {}) {
  return {
    opened,
    readable: streams.readable || new ReadableStream({ start() {} }),
    writable: streams.writable || new WritableStream(),
    close: () => Promise.resolve(),
  };
}

function dnsMock(records) {
  return async (input) => {
    const url = new URL(input);
    const hostname = url.searchParams.get("name");
    const requestedType = url.searchParams.get("type");
    const ip = records[hostname]?.[0];
    const answer = ip && ((requestedType === "A" && !ip.includes(":")) || (requestedType === "AAAA" && ip.includes(":")))
      ? [{ type: ip.includes(":") ? 28 : 1, data: ip }]
      : [];
    return new Response(JSON.stringify({ Status: 0, Answer: answer }), { headers: { "Content-Type": "application/dns-json" } });
  };
}
