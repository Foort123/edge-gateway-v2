import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const renderer = resolve(projectRoot, "ops", "vps", "render_xray_config.py");
const python = process.platform === "win32" ? "py" : "python3";
const pythonArgs = process.platform === "win32" ? ["-3", renderer] : [renderer];

const validInputs = {
  VLESS_UUID: "19f90f29-a21b-4c06-9a6a-3b398806034d",
  XRAY_PRIVATE_KEY: "A".repeat(43),
  REALITY_TARGET: "www.example.net:443",
  REALITY_SERVER_NAME: "www.example.net",
  REALITY_SHORT_ID: "0123456789abcdef",
  XRAY_PORT: "443",
};

function render(overrides = {}) {
  return spawnSync(python, [...pythonArgs, "--stdout"], {
    cwd: projectRoot,
    encoding: "utf8",
    env: { ...process.env, ...validInputs, ...overrides },
  });
}

test("VPS Xray renderer emits VLESS REALITY/Vision with DoH and private-range deny rules", () => {
  const result = render();
  assert.equal(result.status, 0, result.stderr);
  const config = JSON.parse(result.stdout);

  assert.equal(config.inbounds[0].protocol, "vless");
  assert.equal(config.inbounds[0].settings.clients[0].flow, "xtls-rprx-vision");
  assert.equal(config.inbounds[0].streamSettings.network, "raw");
  assert.equal(config.inbounds[0].streamSettings.security, "reality");
  assert.equal(config.inbounds[0].streamSettings.realitySettings.target, "www.example.net:443");
  assert.deepEqual(config.dns.servers, ["https+local://1.1.1.1/dns-query"]);
  assert.equal(config.routing.domainStrategy, "IPIfNonMatch");
  assert.ok(config.routing.rules[0].ip.includes("10.0.0.0/8"));
  assert.ok(config.routing.rules[0].ip.includes("fc00::/7"));
});

test("VPS Xray renderer rejects malformed auth, keys, target, SNI, short ID, and port", () => {
  const cases = [
    { VLESS_UUID: "not-a-uuid" },
    { XRAY_PRIVATE_KEY: "short" },
    { REALITY_TARGET: "127.0.0.1:443" },
    { REALITY_SERVER_NAME: "attacker.example" },
    { REALITY_SHORT_ID: "not-hex" },
    { XRAY_PORT: "70000" },
  ];

  for (const overrides of cases) {
    const result = render(overrides);
    assert.equal(result.status, 2, `${JSON.stringify(overrides)} should be rejected`);
    assert.equal(result.stdout, "");
  }
});
