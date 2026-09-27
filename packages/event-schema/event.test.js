import test from "node:test";
import assert from "node:assert/strict";
import { createEvent, validateEvent, eventDedupKey } from "./index.js";

const base = {
  type: "program_control_changed",
  cluster: "devnet",
  mode: "fixture_simulation",
  occurredAt: "2026-09-26T09:30:00.000Z",
  subject: { type: "program", id: "Program111" },
  severity: "high",
  uncertainty: "single_source",
  evidenceIds: ["evidence:program-control:1"],
  affectedPosition: { wallet: "Wallet111", mint: "Mint111", rawAmount: "1000000" },
  affectedValue: null,
  recommendedAction: "Review the upgrade authority before transacting.",
  details: { before: "AuthorityA", after: "AuthorityB" },
};

test("creates deterministic event identity and deduplication key", () => {
  const first = createEvent(base);
  const second = createEvent({ ...base, evidenceIds: [...base.evidenceIds] });
  assert.equal(first.id, second.id);
  assert.equal(first.dedupKey, second.dedupKey);
  assert.deepEqual(validateEvent(first), { valid: true, errors: [] });
});

test("deduplication changes across cluster, mode, subject, or details", () => {
  const original = eventDedupKey(base);
  assert.notEqual(original, eventDedupKey({ ...base, cluster: "mainnet-beta" }));
  assert.notEqual(original, eventDedupKey({ ...base, mode: "historical_replay" }));
  assert.notEqual(original, eventDedupKey({ ...base, subject: { ...base.subject, id: "Other" } }));
  assert.notEqual(original, eventDedupKey({ ...base, details: { ...base.details, after: "AuthorityC" } }));
});

test("rejects simulated mode on mainnet and missing evidence", () => {
  const result = validateEvent({ ...base, cluster: "mainnet-beta", evidenceIds: [] });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /fixture_simulation/);
  assert.match(result.errors.join(" "), /evidenceIds/);
});

test("rejects vague events without action or uncertainty", () => {
  const result = validateEvent({ ...base, recommendedAction: "", uncertainty: "" });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /recommendedAction/);
  assert.match(result.errors.join(" "), /uncertainty/);
});
