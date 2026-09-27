import test from "node:test";
import assert from "node:assert/strict";
import { createIngestionRunner } from "../src/domains/indexer/runner.js";

test("one cycle executes recent, process, accounts in strict order", async () => {
  const calls = [];
  const runner = createIngestionRunner({
    intervalMs: 10,
    runStep: async step => { calls.push(step); return { code: 0, output: `${step}-ok` }; },
    inspectSource: () => ({ available: true, counts: { pending: 0 }, freshness: { status: "live" } }),
    now: (() => { let n = 1000; return () => ++n; })(),
  });
  const result = await runner.runOnce();
  assert.deepEqual(calls, ["recent", "process", "accounts"]);
  assert.equal(result.ok, true);
  assert.equal(result.startedAt, 1001);
  assert.equal(result.finishedAt, 1002);
  assert.equal(result.source.freshness.status, "live");
});

test("failed step stops cycle and records exact stage", async () => {
  const calls = [];
  const runner = createIngestionRunner({
    runStep: async step => {
      calls.push(step);
      return step === "process" ? { code: 1, output: "rpc failed" } : { code: 0, output: "ok" };
    },
    inspectSource: () => ({ available: true }),
    now: () => 1000,
  });
  const result = await runner.runOnce();
  assert.deepEqual(calls, ["recent", "process"]);
  assert.equal(result.ok, false);
  assert.equal(result.failedStep, "process");
  assert.equal(result.error, "rpc failed");
});

test("overlapping cycle is rejected", async () => {
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  const runner = createIngestionRunner({
    runStep: async () => { await blocked; return { code: 0, output: "ok" }; },
    inspectSource: () => ({ available: true }),
    now: () => 1000,
  });
  const first = runner.runOnce();
  await Promise.resolve();
  const second = await runner.runOnce();
  assert.deepEqual(second, { ok: false, skipped: true, reason: "cycle_already_running" });
  release();
  await first;
});

test("status survives failed cycle through injected status store", async () => {
  let stored = null;
  const runner = createIngestionRunner({
    runStep: async () => ({ code: 1, output: "boom" }),
    inspectSource: () => ({ available: true }),
    writeStatus: status => { stored = status; },
    now: () => 1000,
  });
  await runner.runOnce();
  assert.equal(stored.state, "failed");
  assert.equal(stored.lastResult.failedStep, "recent");
  assert.equal(runner.getStatus().state, "failed");
});
