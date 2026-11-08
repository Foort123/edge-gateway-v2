import test from "node:test";
import assert from "node:assert/strict";
import { connectToTarget } from "../functions/_lib/outbound.js";

test("direct TCP resolves hostnames and enables socket half-open mode", async () => {
  let connected;
  const connect = (address, options) => {
    connected = { address, options };
    return fakeSocket();
  };
  const socket = await connectToTarget(
    { host: "example.com", port: 443 },
    { connect, fetchImpl: dnsMock({ "example.com": ["93.184.216.34"] }) },
  );

  assert.ok(socket.socket);
  assert.equal(socket.prebuffer.byteLength, 0);
  assert.deepEqual(connected.address, { hostname: "93.184.216.34", port: 443 });
  assert.deepEqual(connected.options, { allowHalfOpen: true });
});

test("a failed direct socket is closed and no external proxy is attempted", async () => {
  const failure = new Error("direct socket blocked by the Pages runtime");
  let attempts = 0;
  let closed = false;
  const connect = () => {
    attempts += 1;
    return fakeSocket(Promise.reject(failure), {
      close: async () => { closed = true; },
    });
  };

  await assert.rejects(connectToTarget(
    { host: "example.com", port: 443 },
    { connect, fetchImpl: dnsMock({ "example.com": ["93.184.216.34"] }) },
  ), /direct socket blocked/);

  assert.equal(attempts, 1);
  assert.equal(closed, true);
});

function fakeSocket(opened = Promise.resolve(), streams = {}) {
  return {
    opened,
    readable: streams.readable || new ReadableStream({ start() {} }),
    writable: streams.writable || new WritableStream(),
    close: streams.close || (() => Promise.resolve()),
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
