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

test("stage latency uses a separate high-resolution clock", async () => {
  const telemetry = [];
  const clockValues = [10, 15, 20, 27, 30, 39];
  const runner = createIngestionRunner({
    runStep: async () => ({ code: 0, output: "ok" }),
    inspectSource: () => ({ available: true }),
    recordTelemetry: sample => telemetry.push(sample),
    now: (() => { let n = 1000; return () => ++n; })(),
    highResolutionNow: () => clockValues.shift(),
  });

  const result = await runner.runOnce();

  assert.equal(result.startedAt, 1001);
  assert.equal(result.finishedAt, 1002);
  assert.deepEqual(telemetry.slice(0, 3).map(sample => sample.latencyMs), [5, 7, 9]);
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

test("thrown runStep errors report the active stage in results and incidents", async () => {
  const incidents = [];
  const runner = createIngestionRunner({
    runStep: async step => {
      if (step === "process") throw new Error("process exploded");
      return { code: 0, output: "ok" };
    },
    inspectSource: () => ({ available: true }),
    recordIncident: incident => incidents.push(incident),
    now: (() => { let n = 1000; return () => ++n; })(),
  });

  const result = await runner.runOnce();

  assert.equal(result.failedStep, "process");
  assert.equal(result.startedAt, 1001);
  assert.equal(result.finishedAt, 1002);
  assert.equal(incidents[0].detail.stage, "process");
});

test("inspectSource exceptions fail the inspect stage", async () => {
  const incidents = [];
  const runner = createIngestionRunner({
    runStep: async () => ({ code: 0, output: "ok" }),
    inspectSource: () => { throw new Error("inspection exploded"); },
    recordIncident: incident => incidents.push(incident),
    now: (() => { let n = 2000; return () => ++n; })(),
  });

  const result = await runner.runOnce();

  assert.equal(result.ok, false);
  assert.equal(result.failedStep, "inspect");
  assert.equal(result.startedAt, 2001);
  assert.equal(result.finishedAt, 2002);
  assert.equal(incidents[0].detail.stage, "inspect");
});

test("unavailable inspected source fails with inspect telemetry and incident", async () => {
  const telemetry = [], incidents = [];
  const source = { available: false, reason: "source_not_found", freshness: { status: "unknown" } };
  const runner = createIngestionRunner({
    runStep: async () => ({ code: 0, output: "ok" }),
    inspectSource: () => source,
    recordTelemetry: sample => telemetry.push(sample),
    recordIncident: incident => incidents.push(incident),
    now: (() => { let n = 3000; return () => ++n; })(),
  });

  const result = await runner.runOnce();

  assert.equal(result.ok, false);
  assert.equal(result.failedStep, "inspect");
  assert.equal(result.error, "source_not_found");
  assert.equal(result.source, source);
  assert.equal(result.startedAt, 3001);
  assert.equal(result.finishedAt, 3002);
  assert.deepEqual(telemetry.at(-1), {
    sampledAt: 3002,
    success: false,
    timeout: false,
    latencyMs: null,
    provider: null,
    stage: "inspect",
    sourceLagMs: null,
    slot: null,
    backlog: null,
    processingLagMs: null,
  });
  assert.equal(incidents[0].detail.stage, "inspect");
  assert.equal(runner.getStatus().state, "failed");
});

test("incompatible source schema fails the inspect stage", async () => {
  const incidents = [];
  const source = { available: true, schema: { compatible: false, problems: ["raw_instructions_missing_program_id"] }, freshness: { status: "stale" } };
  const runner = createIngestionRunner({
    runStep: async () => ({ code: 0, output: "ok" }),
    inspectSource: () => source,
    recordIncident: incident => incidents.push(incident),
    now: (() => { let n = 3500; return () => ++n; })(),
  });
  const result = await runner.runOnce();
  assert.equal(result.ok, false);
  assert.equal(result.failedStep, "inspect");
  assert.equal(result.error, "source_schema_incompatible");
  assert.equal(incidents[0].kind, "source_incompatible");
  assert.equal(runner.getStatus().state, "failed");
});

test("available stale source may succeed while remaining explicitly stale", async () => {
  const source = { available: true, schema: { compatible: true }, freshness: { status: "stale", ageSeconds: 600 } };
  const runner = createIngestionRunner({
    runStep: async () => ({ code: 0, output: "ok" }),
    inspectSource: () => source,
    now: (() => { let n = 4000; return () => ++n; })(),
  });

  const result = await runner.runOnce();

  assert.equal(result.ok, true);
  assert.equal(result.source, source);
  assert.equal(result.source.freshness.status, "stale");
  assert.equal(result.startedAt, 4001);
  assert.equal(result.finishedAt, 4002);
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

test("cycle records stage telemetry, backlog, provider failure and recovery incident", async () => {
  const telemetry = [], incidents = [];
  const runner = createIngestionRunner({
    runStep: async step => step === "recent" ? { code: 1, timedOut: true, output: "https://secret.invalid?api-key=hidden failed", provider: "helius-1", latencyMs: 25 } : { code: 0, output: "ok" },
    inspectSource: () => ({ available: true, counts: { pending: 40 }, head: { blockTime: 900 }, freshness: { ageSeconds: 100 } }),
    recordTelemetry: sample => telemetry.push(sample),
    recordIncident: incident => incidents.push(incident),
    initialStatus: { state: "running", cycle: 4, stage: "process", startedAt: 900 },
    now: () => 1000,
  });
  assert.equal(incidents[0].kind, "interrupted_cycle");
  const result = await runner.runOnce();
  assert.equal(result.failedStep, "recent");
  assert.equal(telemetry[0].success, false);
  assert.equal(telemetry[0].timeout, true);
  assert.equal(telemetry[0].provider, "helius-1");
  assert.equal(telemetry[0].latencyMs, 25);
  assert.ok(!result.error.includes("secret.invalid"));
});

test("diagnostics redact credentials across headers, assignments, whitespace, and JSON", async () => {
  const secrets = ["bearer-secret", "pass-secret", "key-secret", "token-secret", "plain-secret", "url-secret"];
  const runner = createIngestionRunner({
    runStep: async () => ({
      code: 1,
      output: "Authorization: Bearer bearer-secret password=pass-secret api_key: key-secret token token-secret {\"secret\":\"plain-secret\"} https://example.invalid/url-secret",
    }),
    inspectSource: () => ({ available: true }),
    now: () => 5000,
  });

  const result = await runner.runOnce();

  for (const secret of secrets) assert.doesNotMatch(result.error, new RegExp(secret));
  assert.match(result.error, /\[redacted-url\]/);
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
