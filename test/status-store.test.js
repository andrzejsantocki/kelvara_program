import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJsonStatusStore } from "../src/domains/indexer/status-store.js";

test("status store writes atomically and reloads after restart", () => {
  const dir = mkdtempSync(join(tmpdir(), "kelvara-status-"));
  try {
    const path = join(dir, "ingestion.json");
    const first = createJsonStatusStore(path);
    first.write({ state: "idle", cycle: 7 });
    const restarted = createJsonStatusStore(path);
    assert.deepEqual(restarted.read(), { state: "idle", cycle: 7 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("missing status file starts with never-run state", () => {
  const store = createJsonStatusStore("/tmp/kelvara-definitely-missing/status.json");
  assert.deepEqual(store.read(), { state: "never-run", lastResult: null });
});
