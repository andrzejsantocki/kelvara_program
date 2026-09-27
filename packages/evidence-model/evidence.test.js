import test from "node:test";
import assert from "node:assert/strict";
import {
  createEvidence,
  validateEvidence,
  conclusionState,
} from "./index.js";

const base = {
  id: "evidence:program-control:1",
  kind: "program_control",
  cluster: "devnet",
  source: { id: "rpc-a", type: "solana_rpc" },
  observedAt: "2026-09-26T09:00:00.000Z",
  fetchedAt: "2026-09-26T09:00:01.000Z",
  freshness: { status: "fresh", ageMs: 1000, maxAgeMs: 15000 },
  confidence: "single_source",
  coverage: "partial",
  state: "degraded",
  value: { upgradeAuthority: "authority-a" },
};

test("creates immutable JSON-safe evidence with explicit provenance", () => {
  const evidence = createEvidence(base);
  assert.deepEqual(validateEvidence(evidence), { valid: true, errors: [] });
  assert.equal(evidence.cluster, "devnet");
  assert.equal(Object.isFrozen(evidence), true);
  assert.equal(JSON.parse(JSON.stringify(evidence)).source.id, "rpc-a");
});

test("rejects unsupported clusters and missing provenance", () => {
  const result = validateEvidence({ ...base, cluster: "testnet", source: {} });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /cluster/);
  assert.match(result.errors.join(" "), /source.id/);
});

test("stale, unavailable, or disagreeing evidence cannot conclude healthy", () => {
  for (const state of ["stale", "unavailable", "disagreement"]) {
    assert.equal(conclusionState([{ ...base, state }]), "unknown");
  }
  assert.equal(conclusionState([{ ...base, state: "active", coverage: "complete", confidence: "verified" }]), "healthy");
});

test("evidence from different clusters cannot form one conclusion", () => {
  assert.throws(
    () => conclusionState([base, { ...base, id: "evidence:2", cluster: "mainnet-beta" }]),
    /mixed_clusters/,
  );
});

test("observed time cannot be after fetched time", () => {
  const result = validateEvidence({
    ...base,
    observedAt: "2026-09-26T09:00:02.000Z",
    fetchedAt: "2026-09-26T09:00:01.000Z",
  });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /observedAt/);
});
