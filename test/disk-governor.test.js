import test from "node:test";
import assert from "node:assert/strict";
import { evaluateDiskPressure, runDiskGovernor } from "../src/platform/storage/disk-governor.js";

const state = utilization => ({ totalBytes: 1000, freeBytes: 1000 * (1-utilization), dbBytes: 10, telemetryGrowthBytesPerSecond: null });

test("disk thresholds choose deterministic escalating action", () => {
  assert.equal(evaluateDiskPressure(state(.69)).action, "normal");
  assert.equal(evaluateDiskPressure(state(.70)).action, "warning");
  assert.equal(evaluateDiskPressure(state(.80)).action, "compact");
  assert.equal(evaluateDiskPressure(state(.85)).action, "prune");
  assert.equal(evaluateDiskPressure({ ...state(.90), freeBytes: 40 }).action, "pause-backfill");
});

test("configured evidence quota drives pruning independently of host filesystem utilization", () => {
  const hostMostlyEmpty = { totalBytes: 1_000_000, freeBytes: 900_000, dbBytes: 85, telemetryGrowthBytesPerSecond: null };
  const result = evaluateDiskPressure(hostMostlyEmpty, { maxBytes: 100 });
  assert.equal(result.utilization, .85);
  assert.equal(result.action, "prune");
  assert.equal(result.maxBytes, 100);
  assert.equal(result.remainingBytes, 15);
});

test("governor only invokes telemetry maintenance and pauses optional backfill", () => {
  const calls = [];
  const result = runDiskGovernor({ diskStats: () => ({ ...state(.90), freeBytes: 40 }), compact: () => calls.push("compact"), pruneTelemetry: () => calls.push("prune") });
  assert.deepEqual(calls, ["compact", "prune"]);
  assert.equal(result.pauseOptionalBackfill, true);
  assert.deepEqual(result.thresholds, { warning: .70, compact: .80, prune: .85 });
});
