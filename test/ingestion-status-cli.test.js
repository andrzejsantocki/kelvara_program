import test from "node:test";
import assert from "node:assert/strict";
import { formatIngestionStatus } from "../src/apps/demo-cli/ingestion-status.js";

test("formats ingestion progress, freshness, pending work, and latency", () => {
  const text = formatIngestionStatus({
    runner: { state: "idle", cycle: 4, lastResult: { ok: true, startedAt: 100, finishedAt: 108 } },
    source: { available: true, freshness: { status: "live", ageSeconds: 3 }, counts: { pending: 12, failed: 2 }, ingestion: { caughtUp: false } },
  });
  assert.match(text, /Runner state\s+idle/);
  assert.match(text, /Cycle\s+4/);
  assert.match(text, /Freshness\s+live \(3s old\)/);
  assert.match(text, /Pending\s+12/);
  assert.match(text, /Failed\s+2/);
  assert.match(text, /Last cycle latency\s+8s/);
  assert.match(text, /Catch-up\s+bounded per cycle/);
});

test("shows current stage while a cycle is running", () => {
  const text = formatIngestionStatus({
    runner: { state: "running", cycle: 5, stage: "process", startedAt: 100 },
    source: { available: false, reason: "source_not_found" },
  });
  assert.match(text, /Current stage\s+process/);
  assert.match(text, /Source\s+unavailable: source_not_found/);
});
