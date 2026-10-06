import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createApp } from "../src/platform/http/app.js";

const position = (wallet = "wallet-public") => ({ wallet, targetId: "target-a", protocol: "kamino", adapterVersion: 1, kind: "vault", asset: "USDC", amount: "10", valueUsd: "10", source: "rpc" });
const binding = (bindingId, ruleId) => ({ bindingId, targetId: "target-a", ruleId, ruleVersion: 1, display: { name: ruleId } });
const receipt = (bindingId, result = "pass") => ({ receiptId: `receipt-${bindingId}`, idempotencyKey: `key-${bindingId}`, policyRevision: 1, ruleId: bindingId, ruleVersion: 1, bindingId, targetId: "target-a", evidenceRefs: ["obs-1"], evaluatorVersion: "v1", result, evaluatedAt: "2026-10-06T10:00:00.000Z", observedAt: "2026-10-06T09:59:00.000Z", provenance: { sourceId: "hub", schemaVersion: "receipt-v1", producerVersion: "v1" } });
const safeguards = { policyRevision: 1, global: { bindings: [binding("global-binding", "global-rule")], receipts: [receipt("global-binding")] }, privateByWallet: { "wallet-public": { bindings: [binding("private-binding", "private-rule")], receipts: [receipt("private-binding", "fail")] } } };

async function withApp(options, run) {
  const app = createApp({ inspectSource: () => ({}), discoverWallet: async wallet => ({ wallet, positions: [position(wallet)] }), getSafeguards: async () => ({ ...safeguards, positions: [position()] }), ...options });
  app.listen(0, "127.0.0.1"); await once(app, "listening");
  try { await run(`http://127.0.0.1:${app.address().port}`); } finally { app.close(); await once(app, "close"); }
}

test("authenticated owner receives global and private safeguards", async () => withApp({ privateSafeguardToken: "owner-token" }, async base => {
  const response = await fetch(`${base}/api/wallets/wallet-public/positions`, { headers: { authorization: "Bearer owner-token" } });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).positions[0].safeguards.map(x => x.bindingId), ["global-binding", "private-binding"]);
}));

test("public address inspection exposes global safeguards only", async () => withApp({ privateSafeguardToken: "owner-token" }, async base => {
  const body = await fetch(`${base}/api/wallets/wallet-public/positions`).then(r => r.json());
  assert.deepEqual(body.positions[0].safeguards.map(x => x.bindingId), ["global-binding"]);
  assert.equal(JSON.stringify(body).includes("private-binding"), false);
}));

test("wrong token cannot request private projection", async () => withApp({ privateSafeguardToken: "owner-token" }, async base => {
  const body = await fetch(`${base}/api/wallets/wallet-public/positions`, { headers: { authorization: "Bearer other-token" } }).then(r => r.json());
  assert.deepEqual(body.positions[0].safeguards.map(x => x.bindingId), ["global-binding"]);
}));

test("private safeguard timeout fails closed as unknown", async () => withApp({ privateSafeguardToken: "owner-token", getSafeguards: async () => { throw new Error("timeout"); } }, async base => {
  const response = await fetch(`${base}/api/wallets/wallet-public/positions`, { headers: { authorization: "Bearer owner-token" } });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).positions[0].safeguards.length, 0);
}));
