import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createConsumerStore } from "../src/platform/storage/consumer-store.js";

const TARGET = { cluster: "devnet", protocol: "onre", kind: "account", address: "A" };

function completeEvidence(targetId, overrides = {}) {
  return {
    id: "ev-1", targetId, observedAt: 100, fetchedAt: 101,
    value: { authority: "old", nested: { b: 2, a: 1 } },
    availability: "available", source: "rpc-1", slot: 10,
    timeout: false, latencyMs: 12.5, sourceLagMs: 3,
    disagreement: false, backlog: 4, processingLagMs: 1.5,
    ...overrides,
  };
}

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "kelvara-consumer-"));
  const path = join(dir, "consumer.sqlite");
  return { path, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("shared positions deduplicate one watch target", () => {
  const { path, cleanup } = fixture();
  try {
    const store = createConsumerStore({ path });
    const target = { cluster: "mainnet-beta", protocol: "onre", kind: "account", address: "Account1" };
    const first = store.linkPosition("client-a:position-1", target);
    const second = store.linkPosition("client-b:position-1", target);
    assert.equal(first.targetId, second.targetId);
    assert.equal(store.listTargets().length, 1);
    assert.equal(store.listTargets()[0].positionCount, 2);
    store.close();
  } finally { cleanup(); }
});

test("wallet coverage excludes stale non-wallet position links", () => {
  const { path, cleanup } = fixture();
  try {
    const store = createConsumerStore({ path });
    const target = { cluster: "mainnet-beta", protocol: "kamino", kind: "vault", address: "Vault1" };
    const walletId = "883AnESJiUVzCnwowgaWCpXp4EGsK4JMVzUUUcjSSs62";
    const { targetId } = store.linkPosition(walletId, target);
    store.linkPosition("legacy-pseudonymous-subject", target);
    store.recordClientActivity({ id: "wallet-observation-1", walletId, targetId, event: "protection_armed", status: "active", observedAt: 100 });

    assert.equal(store.listTargets()[0].walletCount, 1);
    assert.deepEqual(store.getCoverage(), { walletTargetLinks: 1, distinctWallets: 1 });
    store.close();
  } finally { cleanup(); }
});

test("restart restores targets, current state, evidence, events, cursors and incidents", () => {
  const { path, cleanup } = fixture();
  try {
    let store = createConsumerStore({ path });
    const { targetId } = store.linkPosition("p1", { cluster: "mainnet-beta", protocol: "p", kind: "account", address: "A" });
    store.recordEvidence({ id: "e1", targetId, observedAt: 10, fetchedAt: 11, value: { x: 1 }, availability: "available", slot: 7 });
    store.setCursor("producer", { slot: 7 }, 11);
    store.recordIncident({ id: "i1", kind: "interrupted_cycle", startedAt: 9, detail: { cycle: 2 } });
    store.close();
    store = createConsumerStore({ path });
    assert.equal(store.listTargets().length, 1);
    assert.deepEqual(store.getCurrentState(targetId).value, { x: 1 });
    assert.deepEqual(store.getCursor("producer"), { value: { slot: 7 }, updatedAt: 11 });
    assert.equal(store.listIncidents()[0].kind, "interrupted_cycle");
    assert.deepEqual(store.counts(), { targets: 1, evidence: 1, events: 1, telemetry: 1, incidents: 1 });
    store.close();
  } finally { cleanup(); }
});

test("evidence ID replay rejects every changed immutable evidence field", () => {
  const { path, cleanup } = fixture();
  try {
    const store = createConsumerStore({ path });
    const { targetId } = store.linkPosition("p1", TARGET);
    const otherTargetId = store.linkPosition("p2", { ...TARGET, address: "B" }).targetId;
    const base = completeEvidence(targetId);
    assert.equal(store.recordEvidence(base).inserted, true);

    const mutations = [
      ["targetId", otherTargetId], ["observedAt", 102], ["fetchedAt", 103],
      ["value", { authority: "changed" }], ["availability", "unavailable"],
      ["source", "rpc-2"], ["slot", 11], ["timeout", true],
      ["latencyMs", 13.5], ["sourceLagMs", 4], ["disagreement", true],
      ["backlog", 5], ["processingLagMs", 2.5],
    ];
    for (const [field, value] of mutations) {
      assert.throws(() => store.recordEvidence({ ...base, [field]: value }), {
        name: "TypeError", message: "conflicting_evidence_id",
      }, field);
    }
    assert.deepEqual(store.counts(), { targets: 2, evidence: 1, events: 1, telemetry: 1, incidents: 0 });
    store.close();
  } finally { cleanup(); }
});

test("evidence integrity survives restart through versioned persisted payload hashes", () => {
  const { path, cleanup } = fixture();
  try {
    let store = createConsumerStore({ path });
    const { targetId } = store.linkPosition("p1", TARGET);
    const base = completeEvidence(targetId);
    store.recordEvidence(base);
    store.close();

    const db = new DatabaseSync(path);
    assert.equal(db.prepare("PRAGMA user_version").get().user_version, 5);
    const row = db.prepare("SELECT payload_hash FROM evidence WHERE id=?").get(base.id);
    assert.match(row.payload_hash, /^[a-f0-9]{64}$/);
    db.close();

    store = createConsumerStore({ path });
    assert.throws(() => store.recordEvidence({ ...base, latencyMs: 99 }), /conflicting_evidence_id/);
    assert.deepEqual(store.recordEvidence(base), { inserted: false, changed: false, eventCreated: false });
    store.close();
  } finally { cleanup(); }
});

test("current state ordering rejects lower tuples without false material events", () => {
  const { path, cleanup } = fixture();
  try {
    const store = createConsumerStore({ path });
    const { targetId } = store.linkPosition("p1", TARGET);
    const newer = completeEvidence(targetId, { id: "z-new", observedAt: 100, slot: 20, fetchedAt: 105, value: { version: "new" } });
    const lowerSlot = completeEvidence(targetId, { id: "a-old", observedAt: 100, slot: 19, fetchedAt: 999, value: { version: "old" } });
    assert.deepEqual(store.recordEvidence(newer), { inserted: true, changed: true, eventCreated: true });
    assert.deepEqual(store.recordEvidence(lowerSlot), { inserted: true, changed: false, eventCreated: true });
    assert.equal(store.getCurrentState(targetId).evidenceId, newer.id);
    assert.deepEqual(store.counts(), { targets: 1, evidence: 2, events: 2, telemetry: 2, incidents: 0 });
    store.close();
  } finally { cleanup(); }
});

test("null slots skip slot comparison and reverse insertion yields identical current state", () => {
  function currentFor(order) {
    const { path, cleanup } = fixture();
    try {
      const store = createConsumerStore({ path });
      const { targetId } = store.linkPosition("p1", TARGET);
      const rows = {
        known: completeEvidence(targetId, { id: "known", observedAt: 100, slot: 999, fetchedAt: 101, value: { winner: false } }),
        unknown: completeEvidence(targetId, { id: "unknown", observedAt: 100, slot: null, fetchedAt: 102, value: { winner: true } }),
      };
      for (const name of order) store.recordEvidence(rows[name]);
      const result = { state: store.getCurrentState(targetId), counts: store.counts() };
      store.close();
      return result;
    } finally { cleanup(); }
  }

  const forward = currentFor(["known", "unknown"]);
  const reverse = currentFor(["unknown", "known"]);
  assert.equal(forward.state.evidenceId, "unknown");
  assert.deepEqual(reverse.state, forward.state);
  assert.equal(forward.counts.evidence, 2);
  assert.equal(reverse.counts.evidence, 2);
  assert.equal(forward.counts.telemetry, 2);
  assert.equal(reverse.counts.telemetry, 2);
  assert.equal(forward.counts.events, 2);
  assert.equal(reverse.counts.events, 2);
});

test("consumer store rejects databases from a newer schema version without mutation", () => {
  const { path, cleanup } = fixture();
  try {
    const db = new DatabaseSync(path);
    db.exec("PRAGMA user_version=99");
    db.close();
    assert.throws(() => createConsumerStore({ path }), /unsupported_schema_version/);
    const unchanged = new DatabaseSync(path);
    assert.equal(unchanged.prepare("PRAGMA user_version").get().user_version, 99);
    unchanged.close();
  } finally { cleanup(); }
});

test("evidence ID breaks otherwise tied current ordering independent of insertion order", () => {
  function currentId(order) {
    const { path, cleanup } = fixture();
    try {
      const store = createConsumerStore({ path });
      const { targetId } = store.linkPosition("p1", TARGET);
      for (const evidenceId of order) store.recordEvidence(completeEvidence(targetId, {
        id: evidenceId, observedAt: 100, slot: null, fetchedAt: 101, value: { evidenceId },
      }));
      const result = store.getCurrentState(targetId).evidenceId;
      store.close();
      return result;
    } finally { cleanup(); }
  }
  assert.equal(currentId(["a", "b"]), "b");
  assert.equal(currentId(["b", "a"]), "b");
});

test("evidence replay is idempotent and value changes alone emit material events", () => {
  const { path, cleanup } = fixture();
  try {
    const store = createConsumerStore({ path });
    const { targetId } = store.linkPosition("p1", { cluster: "devnet", protocol: "onre", kind: "account", address: "A" });
    const base = { id: "ev-1", targetId, observedAt: 100, fetchedAt: 101, value: { authority: "old" }, availability: "available", source: "rpc-1", slot: 10 };
    assert.deepEqual(store.recordEvidence(base), { inserted: true, changed: true, eventCreated: true });
    assert.deepEqual(store.recordEvidence(base), { inserted: false, changed: false, eventCreated: false });
    assert.deepEqual(store.recordEvidence({ ...base, id: "ev-2", observedAt: 102, fetchedAt: 103 }), { inserted: true, changed: false, eventCreated: false });
    assert.deepEqual(store.recordEvidence({ ...base, id: "ev-3", observedAt: 104, fetchedAt: 105, value: { authority: "new" } }), { inserted: true, changed: true, eventCreated: true });
    const counts = store.counts();
    assert.deepEqual(counts, { targets: 1, evidence: 3, events: 2, telemetry: 3, incidents: 0 });
    assert.deepEqual(store.getCurrentState(targetId).value, { authority: "new" });
    store.close();
  } finally { cleanup(); }
});
