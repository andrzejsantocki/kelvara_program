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

test("operations console static assets are served without exposing a filesystem", async () => {
  const app = createApp({ inspectSource: () => ({}) });
  app.listen(0, "127.0.0.1"); await once(app, "listening");
  const { port } = app.address();
  try {
    for (const [path, type, marker] of [
      ["/operations/", "text/html", "Kelvara operations"],
      ["/operations/app.js", "text/javascript", "/api/operations/status"],
      ["/operations/styles.css", "text/css", ".metric-grid"],
    ]) {
      const response = await fetch(`http://127.0.0.1:${port}${path}`);
      assert.equal(response.status, 200, path);
      assert.match(response.headers.get("content-type"), new RegExp(type));
      assert.match(await response.text(), new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
    const traversal = await fetch(`http://127.0.0.1:${port}/operations/../package.json`);
    assert.equal(traversal.status, 404);
  } finally { app.close(); await once(app, "close"); }
});

test("operations endpoints expose durable status and deduplicated targets", async () => {
  const app = createApp({
    inspectSource: () => ({}),
    getOperationsStatus: () => ({ service: { state: "idle" }, kpis: { backlog: null } }),
    getOperationTargets: () => ({ targets: [{ id: "t1", walletCount: 100 }], coverage: { uniqueTargets: 1, walletTargetLinks: 100, distinctWallets: 100 } }),
  });
  app.listen(0, "127.0.0.1");
  await once(app, "listening");
  const { port } = app.address();
  try {
    const status = await fetch(`http://127.0.0.1:${port}/api/operations/status`).then(r => r.json());
    assert.equal(status.kpis.backlog, null);
    const targets = await fetch(`http://127.0.0.1:${port}/api/operations/targets`).then(r => r.json());
    assert.equal(targets.coverage.walletTargetLinks, 100);
  } finally { app.close(); await once(app, "close"); }
});

test("operations endpoints require configured bearer token", async () => {
  const app = createApp({ inspectSource: () => ({}), operationsToken: "secret", getOperationsStatus: () => ({ ok: true }), getOperationTargets: () => ({ targets: [] }) });
  app.listen(0, "127.0.0.1"); await once(app, "listening");
  const { port } = app.address();
  try {
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/operations/status`)).status, 401);
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/operations/status`, { headers: { authorization: "Bearer secret" } })).status, 200);
  } finally { app.close(); await once(app, "close"); }
});

test("operations status failure hides internal error details", async () => {
  const app = createApp({
    inspectSource: () => ({}),
    getOperationsStatus: async () => { throw new Error("password=secret at /srv/private/status.db"); },
  });
  app.listen(0, "127.0.0.1"); await once(app, "listening");
  const { port } = app.address();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/operations/status`);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "operations_status_unavailable" });
  } finally { app.close(); await once(app, "close"); }
});

test("operations targets failure hides internal error details", async () => {
  const app = createApp({
    inspectSource: () => ({}),
    getOperationTargets: async () => { throw new Error("SELECT failed: token=secret"); },
  });
  app.listen(0, "127.0.0.1"); await once(app, "listening");
  const { port } = app.address();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/operations/targets`);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "operations_targets_unavailable" });
  } finally { app.close(); await once(app, "close"); }
});

test("unavailable source response hides its private database path", async () => {
  const app = createApp({
    inspectSource: () => ({ available: false, reason: "source_not_found", sourcePath: "/srv/private/indexer.sqlite" }),
  });
  app.listen(0, "127.0.0.1"); await once(app, "listening");
  const { port } = app.address();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/sources/onre-indexer`);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { available: false, reason: "source_not_found" });
  } finally { app.close(); await once(app, "close"); }
});

test("source inspection failure hides internal error details", async () => {
  const app = createApp({
    inspectSource: () => { throw new Error("ENOENT /srv/private/indexer.sqlite"); },
  });
  app.listen(0, "127.0.0.1"); await once(app, "listening");
  const { port } = app.address();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/sources/onre-indexer`);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { available: false, reason: "source_inspection_failed" });
  } finally { app.close(); await once(app, "close"); }
});

test("known wallet failures retain their public error behavior", async () => {
  const cases = [
    ["/api/wallets/bad/positions", { discoverWallet: async () => { throw new Error("invalid_wallet"); } }, 400, "invalid_wallet"],
    ["/api/wallets/wallet/positions", { discoverWallet: async () => { throw new Error("all_rpc_sources_failed"); } }, 503, "all_rpc_sources_failed"],
    ["/api/wallets/bad/assurance", { getAssurance: async () => { throw new Error("invalid_wallet"); } }, 400, "invalid_wallet"],
    ["/api/wallets/wallet/assurance", { getAssurance: async () => { throw new Error("supported_position_not_found"); } }, 404, "supported_position_not_found"],
    ["/api/wallets/wallet/assurance", { getAssurance: async () => { throw new Error("all_rpc_sources_failed"); } }, 503, "all_rpc_sources_failed"],
  ];

  for (const [path, dependency, expectedStatus, expectedError] of cases) {
    const app = createApp({ inspectSource: () => ({}), ...dependency });
    app.listen(0, "127.0.0.1"); await once(app, "listening");
    const { port } = app.address();
    try {
      const response = await fetch(`http://127.0.0.1:${port}${path}`);
      assert.equal(response.status, expectedStatus);
      assert.deepEqual(await response.json(), { error: expectedError });
    } finally { app.close(); await once(app, "close"); }
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
