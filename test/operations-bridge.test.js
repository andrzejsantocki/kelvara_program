import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/platform/http/app.js";
import { createOperationsObservationRecorder } from "../src/domains/operations/observations.js";
import { createConsumerStore } from "../src/platform/storage/consumer-store.js";

const observation = {
  schemaVersion: 1,
  service: "kamino-monitor",
  event: "wallet_inspection",
  observationId: "inspection-abc-100",
  walletId: "883AnESJiUVzCnwowgaWCpXp4EGsK4JMVzUUUcjSSs62",
  observedAt: 100,
  latencyMs: 42,
  success: true,
  positionFound: true,
  sourceStatus: "kamino_api_plus_solana_rpc",
  authorityStatus: "active",
  provider: "solana-public-rpc",
};

test("operations observation API stores sanitized local-app activity", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kelvara-observation-"));
  const store = createConsumerStore({ path: join(dir, "consumer.sqlite") });
  const recordOperationObservation = createOperationsObservationRecorder({ store });
  const app = createApp({ inspectSource: () => ({}), recordOperationObservation });
  app.listen(0, "127.0.0.1"); await once(app, "listening");
  const base = `http://127.0.0.1:${app.address().port}`;
  try {
    const response = await fetch(`${base}/api/operations/observations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(observation),
    });
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), { accepted: true });
    const targets = store.listTargets();
    assert.equal(targets.length, 1);
    assert.equal(targets[0].protocol, "kamino");
    assert.equal(targets[0].address, "BoZDRc1RDY9FzUZZ19WT4GbtTnnbXQ8AGSU5ByEw3ut5");
    assert.equal(targets[0].walletCount, 0);
    assert.equal(store.getClient(observation.walletId), null);
    assert.equal(store.listTelemetry().at(-1).provider, "solana-public-rpc");
    assert.equal(store.listTelemetry().at(-1).latencyMs, 42);
    assert.equal(store.counts().evidence, 1);
  } finally {
    app.close(); await once(app, "close"); store.close(); rmSync(dir, { recursive: true, force: true });
  }
});

test("inspection telemetry does not enroll a client", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kelvara-inspection-only-"));
  const store = createConsumerStore({ path: join(dir, "consumer.sqlite") });
  try {
    createOperationsObservationRecorder({ store })(observation);
    assert.deepEqual(store.listClients(), []);
    assert.equal(store.listWallets().length, 0);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("signed protection enrolls a client and stores transaction fingerprints", () => {
  const dir = mkdtempSync(join(tmpdir(), "kelvara-client-enrollment-"));
  const store = createConsumerStore({ path: join(dir, "consumer.sqlite") });
  const record = createOperationsObservationRecorder({ store });
  try {
    record({
      ...observation,
      event: "protection_armed",
      observationId: "arm-abc-200",
      observedAt: 200,
      actionStatus: "active",
      positionFound: undefined,
      evacuationSignatures: ["sig-low", "sig-medium", "sig-high"],
    });
    const clients = store.listClients();
    assert.equal(clients.length, 1);
    assert.equal(clients[0].walletId, observation.walletId);
    assert.equal(clients[0].lastActivityAt, 200);
    assert.equal(clients[0].paymentCount, 0);
    assert.equal(clients[0].paidAmount, null);
    const client = store.getClient(observation.walletId);
    assert.equal(client.evacuationTransactions.length, 3);
    assert.deepEqual(client.evacuationTransactions.map(item => item.signature), ["sig-high", "sig-low", "sig-medium"]);
    assert.ok(client.evacuationTransactions.every(item => item.status === "signed"));
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("operations observation API rejects unknown fields and oversized bodies", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kelvara-observation-reject-"));
  const store = createConsumerStore({ path: join(dir, "consumer.sqlite") });
  const app = createApp({ inspectSource: () => ({}), recordOperationObservation: createOperationsObservationRecorder({ store }) });
  app.listen(0, "127.0.0.1"); await once(app, "listening");
  const base = `http://127.0.0.1:${app.address().port}`;
  try {
    const secret = await fetch(`${base}/api/operations/observations`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...observation, wallet: "raw-wallet-must-not-be-stored" }),
    });
    assert.equal(secret.status, 400);
    const huge = await fetch(`${base}/api/operations/observations`, {
      method: "POST", headers: { "content-type": "application/json" }, body: "x".repeat(20_000),
    });
    assert.equal(huge.status, 413);
    assert.equal(store.counts().evidence, 0);
  } finally { app.close(); await once(app, "close"); store.close(); rmSync(dir, { recursive: true, force: true }); }
});
