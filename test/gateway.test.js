import test from "node:test";
import assert from "node:assert/strict";
import { attachVlessSession } from "../functions/_lib/gateway.js";
import { parseConfiguredUuid, frameVlessUdpPacket } from "../functions/_lib/protocol.js";
import { createPagesHandler } from "../functions/_lib/handler.js";

const uuidText = "26a93e4c-3af1-4fb3-a537-439a1c725ab4";
const uuid = parseConfiguredUuid(uuidText);

test("DNS UDP packets are resolved over DoH and returned as VLESS UDP frames", async () => {
  const server = new FakeWebSocket();
  let fetchCount = 0;
  const session = attachVlessSession(server, {
    env: { ACCESS_UUID: uuidText },
    connect: () => { throw new Error("TCP must not open for DNS UDP"); },
    fetchImpl: async (_url, init) => {
      fetchCount += 1;
      assert.equal(init.method, "POST");
      return new Response(dnsMessage(0x1234, 0x8180), { headers: { "Content-Type": "application/dns-message" } });
    },
  });

  const header = vlessHeader({ command: 2, host: "1.1.1.1", port: 53, uuid });
  const query = dnsMessage(0x1234, 0x0100);
  server.message(join(header, frameVlessUdpPacket(query)));
  await waitFor(() => server.sent.length >= 2);

  assert.equal(fetchCount, 1);
  assert.deepEqual(server.sent[0], Uint8Array.of(0, 0));
  assert.deepEqual(server.sent[1], join(Uint8Array.of(0, 12), dnsMessage(0x1234, 0x8180)));
  await session.close();
});

test("non-DNS UDP is dropped while the WebSocket session stays open", async () => {
  const server = new FakeWebSocket();
  let fetchCount = 0;
  let connectCount = 0;
  const session = attachVlessSession(server, {
    env: { ACCESS_UUID: uuidText },
    connect: () => { connectCount += 1; throw new Error("no TCP connection expected"); },
    fetchImpl: async () => { fetchCount += 1; throw new Error("no DoH query expected"); },
  });

  const header = vlessHeader({ command: 2, host: "1.1.1.1", port: 443, uuid });
  server.message(join(header, frameVlessUdpPacket(Uint8Array.of(1, 2, 3))));
  await waitFor(() => server.sent.length === 1);
  server.message(frameVlessUdpPacket(Uint8Array.of(4, 5)));
  await tick();

  assert.deepEqual(server.sent, [Uint8Array.of(0, 0)]);
  assert.equal(server.readyState, 1);
  assert.equal(fetchCount, 0);
  assert.equal(connectCount, 0);
  await session.close();
});

test("TCP forwards both directions and half-closes the writer when the peer closes", async () => {
  const server = new FakeWebSocket();
  const writes = [];
  let writerClosed = false;
  let socketClosed = false;
  let readerController;
  let connectOptions;
  const socket = {
    opened: Promise.resolve(),
    readable: new ReadableStream({ start(controller) { readerController = controller; } }),
    writable: new WritableStream({
      write(chunk) { writes.push(Uint8Array.from(chunk)); },
      close() { writerClosed = true; },
    }),
    close() { socketClosed = true; return Promise.resolve(); },
  };
  const session = attachVlessSession(server, {
    env: { ACCESS_UUID: uuidText },
    connect: (_address, options) => { connectOptions = options; return socket; },
  });

  server.message(join(vlessHeader({ command: 1, host: "1.1.1.1", port: 443, uuid }), new TextEncoder().encode("hello")));
  await waitFor(() => writes.length === 1);
  server.message(new TextEncoder().encode("world"));
  await waitFor(() => writes.length === 2);
  assert.equal(new TextDecoder().decode(join(...writes)), "helloworld");
  assert.equal(connectOptions.allowHalfOpen, true);

  readerController.enqueue(new TextEncoder().encode("reply"));
  await waitFor(() => server.sent.length === 2);
  assert.deepEqual(server.sent[0], Uint8Array.of(0, 0));
  assert.equal(new TextDecoder().decode(server.sent[1]), "reply");

  server.peerClose();
  await waitFor(() => writerClosed);
  assert.equal(socketClosed, false);
  await session.close();
  assert.equal(socketClosed, true);
});

test("bad UUID closes the session with policy code without opening TCP", async () => {
  const server = new FakeWebSocket();
  let connected = false;
  attachVlessSession(server, {
    env: { ACCESS_UUID: uuidText },
    connect: () => { connected = true; throw new Error("must not connect"); },
  });
  const wrongUuid = parseConfiguredUuid("26a93e4c-3af1-4fb3-a537-439a1c725ab5");
  server.message(vlessHeader({ command: 1, host: "1.1.1.1", port: 443, uuid: wrongUuid }));
  await waitFor(() => server.closeCode === 1008);
  assert.equal(connected, false);
});

test("Pages handler serves static assets and an ordinary browser response", async () => {
  const handler = createPagesHandler({ connect: () => { throw new Error("not used"); } });
  let nextCalls = 0;
  const next = async () => { nextCalls += 1; return new Response("static asset"); };
  const root = await handler({ request: new Request("https://gateway.example/"), next });
  assert.equal(await root.text(), "static asset");
  const browser = await handler({ request: new Request("https://gateway.example/ws"), next });
  assert.equal(browser.status, 200);
  assert.match(await browser.text(), /VLESS connections over WebSocket/);
  assert.equal(nextCalls, 1);
});

test("Pages handler validates upgrade and environment before accepting a socket", async () => {
  let accepted = false;
  class Pair {
    constructor() {
      this[0] = new FakeWebSocket();
      this[1] = new FakeWebSocket();
      this[1].accept = () => { accepted = true; };
    }
  }
  const handler = createPagesHandler({
    connect: () => { throw new Error("not used"); },
    WebSocketPairCtor: Pair,
    upgradeResponse: () => new Response("accepted"),
  });
  const request = new Request("https://gateway.example/ws", {
    headers: { Upgrade: "websocket", Connection: "keep-alive, Upgrade" },
  });
  const response = await handler({ request, env: { ACCESS_UUID: uuidText }, next: async () => new Response("next"), waitUntil() {} });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "accepted");
  assert.equal(accepted, true);

  const notConfigured = await handler({ request, env: {}, next: async () => new Response("next") });
  assert.equal(notConfigured.status, 503);
});

class FakeWebSocket {
  constructor() {
    this.listeners = new Map();
    this.sent = [];
    this.bufferedAmount = 0;
    this.readyState = 1;
  }
  addEventListener(type, callback) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(callback);
    this.listeners.set(type, listeners);
  }
  send(data) { this.sent.push(Uint8Array.from(data)); }
  close(code, reason) {
    this.closeCode = code;
    this.closeReason = reason;
    this.readyState = 3;
    for (const callback of this.listeners.get("close") || []) callback({ code, reason });
  }
  message(data) {
    for (const callback of this.listeners.get("message") || []) callback({ data });
  }
  peerClose() {
    this.readyState = 3;
    for (const callback of this.listeners.get("close") || []) callback({ code: 1000 });
  }
  accept() {}
}

function vlessHeader({ command, host, port, uuid }) {
  const isV4 = /^\d+(?:\.\d+){3}$/.test(host);
  const address = isV4
    ? Uint8Array.from(host.split(".").map(Number))
    : Uint8Array.from([host.length, ...new TextEncoder().encode(host)]);
  const header = new Uint8Array(22 + address.length);
  header.set(uuid, 1);
  header[18] = command;
  header[19] = port >>> 8;
  header[20] = port & 255;
  header[21] = isV4 ? 1 : 2;
  header.set(address, 22);
  return header;
}

function dnsMessage(id, flags) {
  return Uint8Array.of(id >>> 8, id & 255, flags >>> 8, flags & 255, 0, 1, 0, 0, 0, 0, 0, 0);
}

function join(...chunks) {
  const result = new Uint8Array(chunks.reduce((length, chunk) => length + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}

async function waitFor(predicate) {
  const deadline = Date.now() + 1000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for asynchronous event");
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

function tick() {
  return new Promise((resolve) => setTimeout(resolve, 5));
}
