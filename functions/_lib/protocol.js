export const MAX_VLESS_HEADER_BYTES = 1024;
export const MAX_VLESS_UDP_PACKET_BYTES = 0xffff;

export class ClientProtocolError extends Error {
  constructor(message, closeCode = 1002) {
    super(message);
    this.name = "ClientProtocolError";
    this.closeCode = closeCode;
  }
}

export class AuthenticationError extends ClientProtocolError {
  constructor() {
    super("Unauthorized", 1008);
    this.name = "AuthenticationError";
  }
}

export function parseConfiguredUuid(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(normalized)) {
    return null;
  }

  const hex = normalized.replaceAll("-", "");
  const bytes = new Uint8Array(16);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

export function constantTimeEqual(left, right) {
  if (!(left instanceof Uint8Array) || !(right instanceof Uint8Array)) return false;
  if (left.byteLength !== right.byteLength) return false;

  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

export function parseVlessHeader(bytes) {
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError("VLESS header must be a Uint8Array");
  }
  if (bytes.byteLength === 0) return null;
  if (bytes[0] !== 0) throw new ClientProtocolError("Unsupported VLESS version");
  if (bytes.byteLength < 18) return null;

  const addonsLength = bytes[17];
  if (addonsLength !== 0) {
    throw new ClientProtocolError("VLESS addons are not supported");
  }

  const commandOffset = 18;
  if (bytes.byteLength < commandOffset + 4) return null;

  const command = bytes[commandOffset];
  if (command !== 0x01 && command !== 0x02) {
    throw new ClientProtocolError("Unsupported VLESS command");
  }

  const port = (bytes[commandOffset + 1] << 8) | bytes[commandOffset + 2];
  if (port < 1 || port > 65535) {
    throw new ClientProtocolError("Invalid destination port");
  }

  const addressType = bytes[commandOffset + 3];
  let offset = commandOffset + 4;
  let host;

  if (addressType === 0x01) {
    if (bytes.byteLength < offset + 4) return null;
    host = Array.from(bytes.subarray(offset, offset + 4)).join(".");
    offset += 4;
  } else if (addressType === 0x02) {
    if (bytes.byteLength < offset + 1) return null;
    const hostnameLength = bytes[offset];
    offset += 1;
    if (hostnameLength < 1 || hostnameLength > 253) {
      throw new ClientProtocolError("Invalid destination hostname length");
    }
    if (bytes.byteLength < offset + hostnameLength) return null;
    try {
      host = new TextDecoder("utf-8", { fatal: true })
        .decode(bytes.subarray(offset, offset + hostnameLength))
        .toLowerCase()
        .replace(/\.$/, "");
    } catch {
      throw new ClientProtocolError("Destination hostname is not valid UTF-8");
    }
    offset += hostnameLength;
  } else if (addressType === 0x03) {
    if (bytes.byteLength < offset + 16) return null;
    host = ipv6BytesToString(bytes.subarray(offset, offset + 16));
    offset += 16;
  } else {
    throw new ClientProtocolError("Unsupported destination address type");
  }

  const target = { host, port };
  validateTarget(target);
  return {
    version: bytes[0],
    uuid: bytes.slice(1, 17),
    command,
    target,
    consumed: offset,
  };
}

export function validateTarget(target) {
  const { host, port } = target || {};
  if (typeof host !== "string" || host.length < 1 || host.length > 253) {
    throw new ClientProtocolError("Invalid destination hostname");
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ClientProtocolError("Invalid destination port");
  }

  if (host.includes(":")) {
    const groups = parseIPv6(host);
    if (isBlockedIPv6(groups)) {
      throw new ClientProtocolError("Private or reserved destinations are not allowed");
    }
    return;
  }

  if (/^\d+(?:\.\d+){3}$/.test(host)) {
    const octets = parseIPv4(host);
    if (!octets || isBlockedIPv4(octets)) {
      throw new ClientProtocolError("Private or reserved destinations are not allowed");
    }
    return;
  }

  if (!isValidHostname(host)) {
    throw new ClientProtocolError("Invalid destination hostname");
  }
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".test") ||
    host.endsWith(".invalid") ||
    host.endsWith(".example")
  ) {
    throw new ClientProtocolError("Private or reserved destinations are not allowed");
  }
}

export function frameVlessUdpPacket(packet) {
  if (!(packet instanceof Uint8Array) || packet.byteLength > MAX_VLESS_UDP_PACKET_BYTES) {
    throw new RangeError("VLESS UDP packet is too large");
  }
  const frame = new Uint8Array(packet.byteLength + 2);
  frame[0] = (packet.byteLength >>> 8) & 0xff;
  frame[1] = packet.byteLength & 0xff;
  frame.set(packet, 2);
  return frame;
}

export function concatBytes(left, right) {
  const result = new Uint8Array(left.byteLength + right.byteLength);
  result.set(left, 0);
  result.set(right, left.byteLength);
  return result;
}

export class VlessDatagramDecoder {
  constructor() {
    this.chunks = [];
    this.headOffset = 0;
    this.available = 0;
  }

  get pendingBytes() {
    return this.available;
  }

  push(chunk) {
    if (!(chunk instanceof Uint8Array)) {
      throw new TypeError("VLESS UDP data must be a Uint8Array");
    }
    if (chunk.byteLength > 0) {
      this.chunks.push(chunk.slice());
      this.available += chunk.byteLength;
    }
  }

  nextPacket() {
    if (this.available < 2) return null;
    const length = (this.peek(0) << 8) | this.peek(1);
    if (length > MAX_VLESS_UDP_PACKET_BYTES) {
      throw new ClientProtocolError("VLESS UDP packet is too large");
    }
    if (this.available < length + 2) return null;

    this.consume(2);
    return this.consume(length);
  }

  peek(offset) {
    let remaining = offset;
    for (let index = 0; index < this.chunks.length; index += 1) {
      const chunk = this.chunks[index];
      const start = index === 0 ? this.headOffset : 0;
      const length = chunk.byteLength - start;
      if (remaining < length) return chunk[start + remaining];
      remaining -= length;
    }
    throw new RangeError("VLESS UDP decoder read past buffered data");
  }

  consume(length) {
    const result = new Uint8Array(length);
    let written = 0;

    while (written < length) {
      const chunk = this.chunks[0];
      const available = chunk.byteLength - this.headOffset;
      const count = Math.min(available, length - written);
      result.set(chunk.subarray(this.headOffset, this.headOffset + count), written);
      written += count;
      this.headOffset += count;
      this.available -= count;

      if (this.headOffset === chunk.byteLength) {
        this.chunks.shift();
        this.headOffset = 0;
      }
    }

    return result;
  }
}

function isValidHostname(hostname) {
  if (hostname.length < 1 || hostname.length > 253) return false;
  return hostname.split(".").every((label) => {
    return (
      label.length >= 1 &&
      label.length <= 63 &&
      /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
    );
  });
}

function parseIPv4(host) {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => {
    if (!/^\d{1,3}$/.test(part)) return -1;
    const number = Number(part);
    return number >= 0 && number <= 255 && String(number) === part ? number : -1;
  });
  return octets.every((octet) => octet >= 0) ? octets : null;
}

function isBlockedIPv4([a, b, c]) {
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113)
  );
}

function parseIPv6(address) {
  let value = address.toLowerCase();
  if (value.includes(".")) {
    const lastColon = value.lastIndexOf(":");
    const ipv4 = parseIPv4(value.slice(lastColon + 1));
    if (lastColon < 0 || !ipv4) throw new ClientProtocolError("Invalid IPv6 destination");
    const high = ((ipv4[0] << 8) | ipv4[1]).toString(16);
    const low = ((ipv4[2] << 8) | ipv4[3]).toString(16);
    value = value.slice(0, lastColon + 1) + high + ":" + low;
  }

  const separator = value.indexOf("::");
  if (separator !== -1 && value.indexOf("::", separator + 2) !== -1) {
    throw new ClientProtocolError("Invalid IPv6 destination");
  }

  const left = separator === -1 ? value.split(":") : value.slice(0, separator).split(":").filter(Boolean);
  const right = separator === -1 ? [] : value.slice(separator + 2).split(":").filter(Boolean);
  const zeroCount = separator === -1 ? 0 : 8 - left.length - right.length;
  if ((separator === -1 && left.length !== 8) || (separator !== -1 && zeroCount < 1)) {
    throw new ClientProtocolError("Invalid IPv6 destination");
  }

  const groups = [...left, ...Array(zeroCount).fill("0"), ...right].map((group) => {
    if (!/^[0-9a-f]{1,4}$/.test(group)) throw new ClientProtocolError("Invalid IPv6 destination");
    return Number.parseInt(group, 16);
  });
  if (groups.length !== 8) throw new ClientProtocolError("Invalid IPv6 destination");
  return groups;
}

function isBlockedIPv6(groups) {
  const [a, b, c, d, e, f, g, h] = groups;
  if ((a & 0xe000) !== 0x2000) return true; // only global-unicast space is routable here
  const allZeroExceptLast = groups.slice(0, 7).every((group) => group === 0);
  if (groups.every((group) => group === 0) || (allZeroExceptLast && h === 1)) return true;
  if ((a & 0xfe00) === 0xfc00) return true; // unique local
  if ((a & 0xffc0) === 0xfe80 || (a & 0xffc0) === 0xfec0) return true; // link/site local
  if ((a & 0xff00) === 0xff00) return true; // multicast
  if (a === 0x2001 && b === 0x0db8) return true; // documentation

  const ipv4Mapped = [a, b, c, d, e].every((group) => group === 0) && f === 0xffff;
  if (ipv4Mapped) {
    const octets = [g >>> 8, g & 0xff, h >>> 8, h & 0xff];
    return isBlockedIPv4(octets);
  }

  if (a === 0x2002) {
    return isBlockedIPv4([b >>> 8, b & 0xff, c >>> 8, c & 0xff]);
  }
  return false;
}

function ipv6BytesToString(bytes) {
  const groups = [];
  for (let index = 0; index < 16; index += 2) {
    groups.push(((bytes[index] << 8) | bytes[index + 1]).toString(16));
  }
  return groups.join(":");
}
