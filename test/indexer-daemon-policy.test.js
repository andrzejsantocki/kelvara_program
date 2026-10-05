import test from "node:test";
import assert from "node:assert/strict";
import { createDaemonPolicy, createCycleController } from "../src/domains/indexer/daemon-policy.js";

test("routine maintenance runs every cycle and records its outcome", async () => {
  const calls = [];
  const policy = createDaemonPolicy({
    runCycle: async () => ({ ok: true }),
    runRoutineMaintenance: () => (calls.push("routine"), { rawCompacted: 2 }),
    evaluatePressure: () => ({ action: "normal", pauseOptionalBackfill: false }),
    writeMaintenanceStatus: status => calls.push(["status", status]),
    now: () => 100,
  });
  const result = await policy.cycle();
  assert.deepEqual(calls, ["routine", ["status", { state: "ok", lastSuccessfulCompactionAt: 100, compactionLagSeconds: 0, result: { rawCompacted: 2 } }]]);
  assert.equal(result.skipped, false);
});

test("critical pressure pauses optional backfill cycles until pressure recovers", async () => {
  let action = "pause-backfill";
  let cycles = 0;
  const policy = createDaemonPolicy({
    runCycle: async () => (cycles += 1, { ok: true }),
    runRoutineMaintenance: () => ({}),
    evaluatePressure: () => ({ action, pauseOptionalBackfill: action === "pause-backfill" }),
    writeMaintenanceStatus: () => {},
  });
  assert.deepEqual(await policy.cycle(), { ok: false, skipped: true, reason: "disk_pressure_pause", maintenance: {} });
  assert.equal(cycles, 0);
  assert.equal(policy.getLastMaintenance().state, "ok");
  assert.equal(policy.getLastMaintenance().compactionLagSeconds, 0);
  action = "normal";
  assert.equal((await policy.cycle()).ok, true);
  assert.equal(cycles, 1);
});

test("successful maintenance preserves zero compaction lag", async () => {
  const policy = createDaemonPolicy({
    runCycle: async () => ({ ok: true }),
    runRoutineMaintenance: () => ({ compacted: 1 }),
    evaluatePressure: () => ({ action: "normal", pauseOptionalBackfill: false }),
    writeMaintenanceStatus: () => {},
    now: () => 77,
  });
  await policy.cycle();
  assert.equal(policy.getLastMaintenance().compactionLagSeconds, 0);
});

test("overlapping trigger cannot replace the active cycle abort controller", async () => {
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  let firstSignal;
  const controller = createCycleController({
    runCycle: async signal => { firstSignal = signal; await blocked; return { ok: true }; },
  });
  const first = controller.run();
  await Promise.resolve();
  assert.deepEqual(await controller.run(), { ok: false, skipped: true, reason: "cycle_already_running" });
  controller.abort();
  assert.equal(firstSignal.aborted, true);
  release();
  await first;
  await controller.waitForIdle();
});

test("maintenance failure is persisted and does not fabricate success", async () => {
  const statuses = [];
  const policy = createDaemonPolicy({
    runCycle: async () => ({ ok: true }),
    runRoutineMaintenance: () => { throw new Error("disk full"); },
    evaluatePressure: () => ({ action: "normal", pauseOptionalBackfill: false }),
    writeMaintenanceStatus: status => statuses.push(status),
    now: () => 55,
  });
  const result = await policy.cycle();
  assert.equal(result.ok, false);
  assert.equal(result.failedStep, "maintenance");
  assert.deepEqual(statuses, [{ state: "failed", lastFailureAt: 55, error: "maintenance_failed" }]);
});
