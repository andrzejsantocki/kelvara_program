import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createApp } from "../src/platform/http/app.js";

test("health and indexer status endpoints expose service/source separately", async () => {
  const app = createApp({
    inspectSource: () => ({ available: true, schema: { compatible: true }, freshness: { status: "stale" } }),
  });
  app.listen(0, "127.0.0.1");
  await once(app, "listening");
  const { port } = app.address();
  try {
    const health = await fetch(`http://127.0.0.1:${port}/api/health`).then(r => r.json());
    assert.deepEqual(health, { ok: true, service: "kelvara-onre", milestone: "indexer-bridge" });
    const source = await fetch(`http://127.0.0.1:${port}/api/sources/onre-indexer`).then(r => r.json());
    assert.equal(source.available, true);
    assert.equal(source.freshness.status, "stale");
  } finally {
    app.close();
    await once(app, "close");
  }
});

test("unknown API route returns structured 404", async () => {
  const app = createApp({ inspectSource: () => ({}) });
  app.listen(0, "127.0.0.1");
  await once(app, "listening");
  const { port } = app.address();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/nope`);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "not_found" });
  } finally {
    app.close();
    await once(app, "close");
  }
});
