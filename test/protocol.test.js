import test from "node:test";
import assert from "node:assert/strict";
import {
  AuthenticationError,
  ClientProtocolError,
  VlessDatagramDecoder,
  constantTimeEqual,
  frameVlessUdpPacket,
  parseConfiguredUuid,
  parseVlessHeader,
} from "../functions/_lib/protocol.js";

const uuidText = "26a93e4c-3af1-4fb3-a537-439a1c725ab4";
const uuid = parseConfiguredUuid(uuidText);

test("parses a complete VLESS TCP header and leaves payload bytes unconsumed", () => {
  const header = vlessHeader({ command: 1, host: "example.com", port: 443, uuid });
  const payload = Uint8Array.of(0x16, 0x03, 0x01);
  const joined = new Uint8Array(header.length + payload.length);
  joined.set(header);
  joined.set(payload, header.length);

  const parsed = parseVlessHeader(joined);
  assert.equal(parsed.command, 1);
  assert.deepEqual(parsed.target, { host: "example.com", port: 443 });
  assert.deepEqual(parsed.uuid, uuid);
  assert.equal(parsed.consumed, header.length);
  assert.deepEqual(joined.subarray(parsed.consumed), payload);
});

test("returns null for fragmented VLESS headers", () => {
  const header = vlessHeader({ command: 2, host: "1.1.1.1", port: 53, uuid });
  assert.equal(parseVlessHeader(header.subarray(0, 12)), null);
  assert.equal(parseVlessHeader(header.subarray(0, header.length - 1)), null);
});

test("rejects unsupported commands and private destinations", () => {
  assert.throws(() => parseVlessHeader(vlessHeader({ command: 3, host: "example.com", port: 443, uuid })), ClientProtocolError);
  assert.throws(() => parseVlessHeader(vlessHeader({ command: 1, host: "127.0.0.1", port: 80, uuid })), /Private or reserved/);
  assert.throws(() => parseVlessHeader(vlessHeader({ command: 1, host: "fd00:0:0:0:0:0:0:1", port: 80, uuid })), /Private or reserved/);
});

test("parses an IPv6 destination", () => {
  const parsed = parseVlessHeader(vlessHeader({ command: 1, host: "2606:4700:4700:0:0:0:0:1111", port: 443, uuid }));
  assert.equal(parsed.target.port, 443);
  assert.equal(parsed.target.host, "2606:4700:4700:0:0:0:0:1111");
});

test("UUID parser and comparison accept only equal 16-byte identifiers", () => {
  assert.equal(parseConfiguredUuid("invalid"), null);
  assert.equal(constantTimeEqual(uuid, parseConfiguredUuid(uuidText)), true);
  assert.equal(constantTimeEqual(uuid, parseConfiguredUuid("26a93e4c-3af1-4fb3-a537-439a1c725ab5")), false);
  assert.equal(constantTimeEqual(uuid, new Uint8Array(15)), false);
  assert.equal(AuthenticationError.prototype instanceof ClientProtocolError, true);
});

test("VLESS UDP decoder supports fragmentation, multiple frames, and empty datagrams", () => {
  const decoder = new VlessDatagramDecoder();
  const first = frameVlessUdpPacket(Uint8Array.of(1, 2, 3));
  const second = frameVlessUdpPacket(new Uint8Array(0));
  const third = frameVlessUdpPacket(Uint8Array.of(4));
  const combined = new Uint8Array(first.length + second.length + third.length);
  combined.set(first);
  combined.set(second, first.length);
  combined.set(third, first.length + second.length);

  decoder.push(combined.subarray(0, 2));
  assert.equal(decoder.nextPacket(), null);
  decoder.push(combined.subarray(2));
  assert.deepEqual(decoder.nextPacket(), Uint8Array.of(1, 2, 3));
  assert.deepEqual(decoder.nextPacket(), new Uint8Array(0));
  assert.deepEqual(decoder.nextPacket(), Uint8Array.of(4));
  assert.equal(decoder.nextPacket(), null);
});

function vlessHeader({ command, host, port, uuid }) {
  const address = host.includes(":")
    ? Uint8Array.from(host.split(":").flatMap((group) => {
      const normalized = group || "0";
      const value = Number.parseInt(normalized, 16);
      return [(value >>> 8) & 255, value & 255];
    }))
    : /^\d+(?:\.\d+){3}$/.test(host)
      ? Uint8Array.from(host.split(".").map(Number))
      : Uint8Array.from([host.length, ...new TextEncoder().encode(host)]);
  const type = host.includes(":") ? 3 : /^\d+(?:\.\d+){3}$/.test(host) ? 1 : 2;
  const bytes = new Uint8Array(18 + 4 + address.length);
  bytes[0] = 0;
  bytes.set(uuid, 1);
  bytes[17] = 0;
  bytes[18] = command;
  bytes[19] = port >>> 8;
  bytes[20] = port & 255;
  bytes[21] = type;
  bytes.set(address, 22);
  return bytes;
}
