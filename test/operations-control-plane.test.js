import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConsumerStore } from "../src/platform/storage/consumer-store.js";
import { createOperationsService } from "../src/domains/operations/status.js";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "kelvara-control-plane-"));
  const store = createConsumerStore({ path: join(dir, "consumer.sqlite") });
  return { dir, store, close() { store.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test("provider history exposes observed, adverse, and explicit gap hours", () => {
  const f = fixture();
  try {
    f.store.recordTelemetry({ sampledAt: 3600, success: true, latencyMs: 20, provider: "helius" });
    f.store.recordTelemetry({ sampledAt: 10800, success: false, latencyMs: 80, provider: "helius" });
    const service = createOperationsService({ store: f.store, readIngestionStatus: () => ({ state: "idle" }), diskStats: () => ({ totalBytes: 1000, freeBytes: 100, dbBytes: 10 }), startedAt: 0, now: () => 14400 });
    const history = service.getHistory({ hours: 4 });
    assert.deepEqual(history.providers, ["helius"]);
    assert.deepEqual(history.hours.map(hour => hour.state), ["healthy", "gap", "adverse", "gap"]);
  } finally { f.close(); }
});

test("admin evidence quota defaults to 50 GB and persists without redeploy", () => {
  const f = fixture();
  try {
    const service = createOperationsService({ store: f.store, readIngestionStatus: () => ({ state: "idle" }), diskStats: () => ({ totalBytes: 1000, freeBytes: 100, dbBytes: 10 }), now: () => 500 });
    assert.equal(service.getSettings().evidenceQuotaBytes, 50 * 1024 ** 3);
    service.updateSettings({ evidenceQuotaGb: 12 });
    assert.equal(service.getSettings().evidenceQuotaBytes, 12 * 1024 ** 3);
    assert.equal(f.store.getSetting("evidence_quota_bytes").value, 12 * 1024 ** 3);
    assert.throws(() => service.updateSettings({ evidenceQuotaGb: 0 }), /invalid_evidence_quota/);
  } finally { f.close(); }
});

test("protocol indexer inventory labels ONRE counts as ONRE-specific", () => {
  const f = fixture();
  try {
    const service = createOperationsService({ store: f.store, readIngestionStatus: () => ({ state: "idle" }), diskStats: () => ({ totalBytes: 1000, freeBytes: 100, dbBytes: 10 }), inspectIndexers: () => [{ id: "onre-mainnet", protocol: "ONRE", network: "mainnet-beta", counts: { signatures: 84974 } }] });
    const inventory = service.getIndexers();
    assert.equal(inventory.indexers[0].protocol, "ONRE");
    assert.equal(inventory.indexers[0].counts.signatures, 84974);
  } finally { f.close(); }
});

test("client registry excludes inspection-only wallets and exposes SQL-backed commercial facts", () => {
  const f = fixture();
  try {
    const inspectedWallet = "883AnESJiUVzCnwowgaWCpXp4EGsK4JMVzUUUcjSSs62";
    const clientWallet = "FN7B9qYhWmQrWgY6z2T8p6xsULyL1Cmzfa1aM8bB7htn";
    f.store.recordInspectionObservation({ id: "inspect-1", walletId: inspectedWallet, event: "wallet_inspection", status: "observed", observedAt: 10, detail: { positionFound: true } });
    f.store.recordClientActivity({ id: "arm-1", walletId: clientWallet, event: "protection_armed", status: "active", observedAt: 20, detail: {} });
    f.store.recordEvacuationTransaction({ walletId: clientWallet, signature: "signed-evacuation", status: "signed", observedAt: 20 });
    f.store.recordPayment({ id: "payment-1", walletId: clientWallet, amount: "12.50", asset: "USDC", status: "confirmed", paidAt: 21, signature: "payment-signature" });
    const service = createOperationsService({ store: f.store, readIngestionStatus: () => ({ state: "idle" }), diskStats: () => ({ totalBytes: 1000, freeBytes: 100, dbBytes: 10 }) });
    assert.deepEqual(service.getClients().clients.map(item => item.walletId), [clientWallet]);
    const detail = service.getClient(clientWallet);
    assert.equal(detail.lastActivityAt, 21);
    assert.equal(detail.evacuationTransactions[0].signature, "signed-evacuation");
    assert.deepEqual(detail.payments[0], { id: "payment-1", amount: "12.50", asset: "USDC", status: "confirmed", paidAt: 21, signature: "payment-signature" });
    assert.equal(service.getClient(inspectedWallet), null);
  } finally { f.close(); }
});
