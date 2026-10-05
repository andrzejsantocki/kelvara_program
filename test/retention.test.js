import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createConsumerStore } from "../src/platform/storage/consumer-store.js";
import { compactTelemetry, DEFAULT_RETENTION, retentionFromEnv } from "../src/platform/storage/retention.js";

test("tiered compaction is idempotent, preserves aggregates, boundaries and canonical rows", () => {
  const dir = mkdtempSync(join(tmpdir(), "kelvara-retention-"));
  try {
    const store = createConsumerStore({ path: join(dir, "db.sqlite") });
    const { targetId } = store.linkPosition("p", { cluster: "devnet", protocol: "p", kind: "account", address: "a" });
    store.recordEvidence({ id: "canonical", targetId, observedAt: 1, fetchedAt: 1, value: { x: 1 }, availability: "available" });
    store.recordTelemetry({ sampledAt: 100, success: true, latencyMs: 20, sourceLagMs: 5, slot: 3, provider: "rpc" });
    store.recordTelemetry({ sampledAt: 119, success: false, timeout: true, latencyMs: 40, sourceLagMs: 8, slot: 8, disagreement: true, provider: "rpc" });
    store.recordTelemetry({ sampledAt: 118, success: false, timeout: true, provider: "rpc" });
    store.recordTelemetry({ sampledAt: 120, success: true, latencyMs: 10, sourceLagMs: 2, slot: 9, provider: "rpc" });
    store.recordTelemetry({ sampledAt: 120, success: true, provider: "rpc" });
    const policy = { rawSeconds: 30, minuteSeconds: 1000, fifteenMinuteSeconds: 2000, hourSeconds: 3000 };
    const first = compactTelemetry(store, { now: 150, policy });
    const second = compactTelemetry(store, { now: 150, policy });
    assert.equal(first.rawCompacted, 4);
    assert.equal(second.rawCompacted, 0);
    assert.equal(store.listTelemetry({ tier: "raw" }).length, 2);
    const rollup = store.listTelemetry({ tier: "1m" }).find(item => item.provider === "rpc");
    assert.deepEqual({ count: rollup.count, successes: rollup.successes, failures: rollup.failures, timeouts: rollup.timeouts, minLatencyMs: rollup.minLatencyMs, maxLatencyMs: rollup.maxLatencyMs, averageLatencyMs: rollup.averageLatencyMs, maxSourceLagMs: rollup.maxSourceLagMs, minSlot: rollup.minSlot, maxSlot: rollup.maxSlot, disagreements: rollup.disagreements, firstAt: rollup.firstAt, lastAt: rollup.lastAt }, { count: 3, successes: 1, failures: 2, timeouts: 2, minLatencyMs: 20, maxLatencyMs: 40, averageLatencyMs: 30, maxSourceLagMs: 8, minSlot: 3, maxSlot: 8, disagreements: 1, firstAt: 100, lastAt: 119 });
    assert.deepEqual(store.counts(), { targets: 1, evidence: 1, events: 1, telemetry: 2, incidents: 0 });
    assert.deepEqual(DEFAULT_RETENTION, { rawSeconds: 72*3600, minuteSeconds: 7*86400, fifteenMinuteSeconds: 90*86400, hourSeconds: 730*86400 });
    store.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("later raw samples in an existing bucket merge without telemetry loss", () => {
  const dir = mkdtempSync(join(tmpdir(), "kelvara-retention-merge-"));
  try {
    const store = createConsumerStore({ path: join(dir, "db.sqlite") });
    store.recordTelemetry({ sampledAt: 1, success: true, latencyMs: 10, provider: "rpc" });
    assert.equal(store.compactRaw({ before: 2, bucketSeconds: 60, tier: "1m" }), 1);
    store.recordTelemetry({ sampledAt: 3, success: false, timeout: true, latencyMs: 30, provider: "rpc" });
    assert.equal(store.compactRaw({ before: 4, bucketSeconds: 60, tier: "1m" }), 1);
    assert.deepEqual(
      store.listTelemetry({ tier: "1m" }).map(row => ({ count: row.count, successes: row.successes, failures: row.failures, timeouts: row.timeouts, averageLatencyMs: row.averageLatencyMs })),
      [{ count: 2, successes: 1, failures: 1, timeouts: 1, averageLatencyMs: 20 }],
    );
    store.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("later promoted rollups merge into an existing destination bucket", () => {
  const dir = mkdtempSync(join(tmpdir(), "kelvara-retention-promotion-merge-"));
  try {
    const store = createConsumerStore({ path: join(dir, "db.sqlite") });
    store.recordTelemetry({ sampledAt: 1, success: true, latencyMs: 10, provider: "rpc" });
    store.compactRaw({ before: 2, bucketSeconds: 60, tier: "1m" });
    assert.equal(store.compactRollups({ fromTier: "1m", toTier: "15m", before: 2, bucketSeconds: 900 }), 1);
    store.recordTelemetry({ sampledAt: 61, success: false, latencyMs: 30, provider: "rpc" });
    store.compactRaw({ before: 62, bucketSeconds: 60, tier: "1m" });
    assert.equal(store.compactRollups({ fromTier: "1m", toTier: "15m", before: 62, bucketSeconds: 900 }), 1);
    assert.deepEqual(
      store.listTelemetry({ tier: "15m" }).map(row => ({ count: row.count, successes: row.successes, failures: row.failures, averageLatencyMs: row.averageLatencyMs })),
      [{ count: 2, successes: 1, failures: 1, averageLatencyMs: 20 }],
    );
    store.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("latency_count survives tier promotion and hourly rows expire", () => {
  const dir = mkdtempSync(join(tmpdir(), "kelvara-retention-expiry-"));
  try {
    const store = createConsumerStore({ path: join(dir, "db.sqlite") });
    store.recordTelemetry({ sampledAt: 1, success: false, provider: "rpc" });
    store.recordTelemetry({ sampledAt: 2, success: true, latencyMs: 10, provider: "rpc" });
    const policy = { rawSeconds: 10, minuteSeconds: 20, fifteenMinuteSeconds: 30, hourSeconds: 100 };
    compactTelemetry(store, { now: 35, policy });
    assert.deepEqual(store.listTelemetry({ tier: "1h" }).map(row => ({ count: row.count, averageLatencyMs: row.averageLatencyMs })), [{ count: 2, averageLatencyMs: 10 }]);
    const result = compactTelemetry(store, { now: 200, policy });
    assert.equal(result.hourPruned, 1);
    assert.deepEqual(store.listTelemetry({ tier: "1h" }), []);
    assert.deepEqual(store.listTelemetry({ tier: "expired" }), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("hour expiry prunes without creating another tier", () => {
  const calls = [];
  const store = {
    compactRaw: options => (calls.push(["raw", options]), 1),
    compactRollups: options => (calls.push(["rollup", options]), 2),
    pruneRollups: options => (calls.push(["prune", options]), 3),
  };
  const policy = { rawSeconds: 10, minuteSeconds: 20, fifteenMinuteSeconds: 30, hourSeconds: 40 };
  const result = compactTelemetry(store, { now: 100, policy });
  assert.equal(result.hourPruned, 3);
  assert.deepEqual(calls.at(-1), ["prune", { tier: "1h", before: 60 }]);
  assert.equal(calls.some(([, options]) => options.toTier === "expired"), false);
});

test("retention env requires finite positive ordered durations", () => {
  assert.deepEqual(retentionFromEnv({ KELVARA_RETENTION_RAW_SECONDS: "1", KELVARA_RETENTION_1M_SECONDS: "2", KELVARA_RETENTION_15M_SECONDS: "3", KELVARA_RETENTION_1H_SECONDS: "4" }), { rawSeconds: 1, minuteSeconds: 2, fifteenMinuteSeconds: 3, hourSeconds: 4 });
  for (const env of [
    { KELVARA_RETENTION_RAW_SECONDS: "0" },
    { KELVARA_RETENTION_RAW_SECONDS: "NaN" },
    { KELVARA_RETENTION_RAW_SECONDS: "Infinity" },
    { KELVARA_RETENTION_RAW_SECONDS: "3", KELVARA_RETENTION_1M_SECONDS: "2" },
  ]) assert.throws(() => retentionFromEnv(env), /invalid_retention_policy/);
});

test("current schema migrates rollups with latency_count", () => {
  const dir = mkdtempSync(join(tmpdir(), "kelvara-retention-migration-"));
  const path = join(dir, "db.sqlite");
  try {
    const db = new DatabaseSync(path);
    db.exec(`CREATE TABLE telemetry_rollups (
      tier TEXT NOT NULL, bucket_start INTEGER NOT NULL, provider TEXT NOT NULL DEFAULT '',
      count INTEGER NOT NULL, successes INTEGER NOT NULL, failures INTEGER NOT NULL,
      timeouts INTEGER NOT NULL, min_latency_ms REAL, max_latency_ms REAL, latency_sum_ms REAL NOT NULL,
      max_source_lag_ms REAL, min_slot INTEGER, max_slot INTEGER, disagreements INTEGER NOT NULL,
      first_at INTEGER NOT NULL, last_at INTEGER NOT NULL,
      PRIMARY KEY(tier,bucket_start,provider));
      INSERT INTO telemetry_rollups VALUES ('1m',0,'rpc',2,2,0,0,10,30,40,NULL,NULL,NULL,0,1,2);
      PRAGMA user_version=1;`);
    db.close();
    const store = createConsumerStore({ path });
    assert.equal(store.listTelemetry({ tier: "1m" })[0].averageLatencyMs, 20);
    store.close();
    const migrated = new DatabaseSync(path);
    assert.equal(migrated.prepare("PRAGMA user_version").get().user_version, 5);
    assert.equal(migrated.prepare("SELECT latency_count FROM telemetry_rollups").get().latency_count, 2);
    migrated.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
