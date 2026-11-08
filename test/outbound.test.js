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

test("TCP failover tries the next public address and returns the first open socket", async () => {
  const attempts = [];
  let firstClosed = false;
  const expectedSocket = fakeSocket();
  const connect = ({ hostname }) => {
    attempts.push(hostname);
    if (hostname === "93.184.216.34") {
      return fakeSocket(Promise.reject(new Error("first address is unreachable")), {
        close: async () => { firstClosed = true; },
      });
    }
    return expectedSocket;
  };

  const result = await connectToTarget(
    { host: "example.com", port: 443 },
    { connect, fetchImpl: dnsMock({ "example.com": ["93.184.216.34", "1.1.1.1"] }) },
  );

  assert.deepEqual(attempts, ["93.184.216.34", "1.1.1.1"]);
  assert.equal(firstClosed, true);
  assert.equal(result.socket, expectedSocket);
});

test("TCP failover is bounded to four addresses and closes each failed socket", async () => {
  const addresses = ["93.184.216.34", "1.1.1.1", "8.8.8.8", "9.9.9.9", "208.67.222.222"];
  const attempts = [];
  let closed = 0;
  const connect = ({ hostname }) => {
    attempts.push(hostname);
    return fakeSocket(Promise.reject(new Error(`failed at ${hostname}`)), {
      close: async () => { closed += 1; },
    });
  };

  await assert.rejects(
    connectToTarget(
      { host: "example.com", port: 443 },
      { connect, fetchImpl: dnsMock({ "example.com": addresses }) },
    ),
    /failed at 9\.9\.9\.9/,
  );

  assert.deepEqual(attempts, addresses.slice(0, 4));
  assert.equal(closed, 4);
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
    const wantedType = requestedType === "A" ? 1 : 28;
    const answer = (records[hostname] || [])
      .filter((ip) => (ip.includes(":") ? 28 : 1) === wantedType)
      .map((ip) => ({ type: wantedType, data: ip }));
    return new Response(JSON.stringify({ Status: 0, Answer: answer }), { headers: { "Content-Type": "application/dns-json" } });
  };
}
