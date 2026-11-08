import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Pages routes invoke Functions only for the landing page and WebSocket endpoint", async () => {
  const routes = JSON.parse(await readFile(new URL("../public/_routes.json", import.meta.url), "utf8"));
  assert.deepEqual(routes, { version: 1, include: ["/", "/ws", "/ws/*"], exclude: [] });
});

test("sample environment does not contain a production credential", async () => {
  const sample = await readFile(new URL("../.env.example", import.meta.url), "utf8");
  assert.match(sample, /ACCESS_UUID=00000000-0000-4000-8000-000000000000/);
  assert.doesNotMatch(sample, /\b(?:OUTBOUND_PROXY_USERNAME|OUTBOUND_PROXY_PASSWORD)=\S+/);
});
