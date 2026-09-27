import test from "node:test";
import assert from "node:assert/strict";
import { assessIndexerFreshness } from "../src/domains/indexer/source.js";

test("fresh processed indexer data is usable", () => {
  assert.deepEqual(
    assessIndexerFreshness({ newestBlockTime: 1_000, now: 1_020, pending: 0, failed: 0, maxAgeSeconds: 30 }),
    { status: "live", ageSeconds: 20, usable: true, reason: null },
  );
});

test("stale indexer data remains retrospective but cannot be called live", () => {
  assert.deepEqual(
    assessIndexerFreshness({ newestBlockTime: 1_000, now: 1_200, pending: 0, failed: 0, maxAgeSeconds: 30 }),
    { status: "stale", ageSeconds: 200, usable: true, reason: "source_age_exceeded" },
  );
});

test("missing indexer timestamp is unavailable", () => {
  assert.deepEqual(
    assessIndexerFreshness({ newestBlockTime: null, now: 1_200, pending: 0, failed: 0, maxAgeSeconds: 30 }),
    { status: "unavailable", ageSeconds: null, usable: false, reason: "no_indexed_transactions" },
  );
});
