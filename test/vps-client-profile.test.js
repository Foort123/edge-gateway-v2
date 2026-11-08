import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const renderer = resolve(projectRoot, "ops", "vps", "render_vless_profile.py");
const python = process.platform === "win32" ? "py" : "python3";
const pythonArgs = process.platform === "win32" ? ["-3", renderer] : [renderer];

const validInputs = {
  VLESS_UUID: "19f90f29-a21b-4c06-9a6a-3b398806034d",
  XRAY_PUBLIC_KEY: "B".repeat(43),
  REALITY_SERVER_NAME: "www.example.net",
  REALITY_SHORT_ID: "0123456789abcdef",
  ENDPOINT: "203.0.113.10",
  XRAY_PORT: "443",
};

function render(overrides = {}) {
  return spawnSync(python, [...pythonArgs, "--stdout"], {
    cwd: projectRoot,
    encoding: "utf8",
    env: { ...process.env, ...validInputs, ...overrides },
  });
}

test("VPS VLESS profile contains TLS and Vision values required by the Xray inbound", () => {
  const result = render();
  assert.equal(result.status, 0, result.stderr);
  const url = new URL(result.stdout.trim());
  const query = url.searchParams;

  assert.equal(url.protocol, "vless:");
  assert.equal(url.username, validInputs.VLESS_UUID);
  assert.equal(url.hostname, "203.0.113.10");
  assert.equal(url.port, "443");
  assert.equal(query.get("security"), "reality");
  assert.equal(query.get("sni"), validInputs.REALITY_SERVER_NAME);
  assert.equal(query.get("pbk"), validInputs.XRAY_PUBLIC_KEY);
  assert.equal(query.get("sid"), validInputs.REALITY_SHORT_ID);
  assert.equal(query.get("type"), "tcp");
  assert.equal(query.get("flow"), "xtls-rprx-vision");
  assert.equal(query.get("spx"), "/");
});

test("VPS VLESS profile supports IPv6 endpoints and rejects invalid credentials", () => {
  const ipv6 = render({ ENDPOINT: "2001:db8::1" });
  assert.equal(ipv6.status, 0, ipv6.stderr);
  assert.match(ipv6.stdout, /@\[2001:db8::1\]:443\?/);

  for (const overrides of [
    { XRAY_PUBLIC_KEY: "invalid" },
    { REALITY_SERVER_NAME: "not a hostname" },
    { REALITY_SHORT_ID: "g123" },
    { ENDPOINT: "http://example.com" },
    { XRAY_PORT: "70000" },
  ]) {
    const invalid = render(overrides);
    assert.equal(invalid.status, 2, `${JSON.stringify(overrides)} should be rejected`);
    assert.equal(invalid.stdout, "");
  }
});
