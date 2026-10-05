import test from "node:test";
import assert from "node:assert/strict";
import { createIndexerRuntime } from "../src/domains/indexer/runtime.js";

test("runtime restores durable status and persists telemetry and incidents", async () => {
  const writes = [];
  const telemetry = [];
  const incidents = [];
  const statusStore = {
    read: () => ({ state: "running", cycle: 4, startedAt: 90, stage: "process", lastResult: null }),
    write: value => writes.push(value),
  };
  const consumerStore = {
    recordTelemetry: value => telemetry.push(value),
    recordIncident: value => incidents.push(value),
  };
  const runtime = createIndexerRuntime({
    statusStore,
    consumerStore,
    runStep: async step => ({ code: 0, output: step }),
    inspectSource: () => ({ available: true, freshness: { ageSeconds: 2 }, counts: { pending: 3 }, head: { slot: 7 } }),
    now: (() => { let value = 100; return () => value++; })(),
    highResolutionNow: (() => { let value = 0; return () => value += 5; })(),
  });

  assert.equal(incidents[0].kind, "interrupted_cycle");
  const result = await runtime.runOnce();
  assert.equal(result.ok, true);
  assert.equal(result.cycle, 5);
  assert.equal(writes.at(-1).state, "idle");
  assert.equal(telemetry.length, 4);
  assert.equal(telemetry.at(-1).backlog, 3);
});

test("runtime maintenance compacts telemetry before pruning under pressure", () => {
  const calls = [];
  const runtime = createIndexerRuntime({
    statusStore: { read: () => ({ state: "never-run", lastResult: null }), write: () => {} },
    consumerStore: { recordTelemetry: () => {}, recordIncident: () => {} },
    runStep: async () => ({ code: 0, output: "" }),
    inspectSource: () => ({ available: true }),
    maintenance: {
      compact: () => calls.push("compact"),
      pruneTelemetry: () => calls.push("prune"),
      diskStats: () => ({ totalBytes: 100, freeBytes: 10, dbBytes: 5, telemetryGrowthBytesPerSecond: null }),
    },
  });

  const pressure = runtime.runMaintenance();
  assert.deepEqual(calls, ["compact", "prune"]);
  assert.equal(pressure.action, "prune");
});
