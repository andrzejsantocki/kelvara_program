import test from "node:test";
import assert from "node:assert/strict";
import { evaluateRule, validateRule, summarizeRule } from "./index.js";

const evidence = {
  id: "evidence:nav:1",
  cluster: "devnet",
  state: "active",
  freshness: { status: "fresh", ageMs: 1000, maxAgeMs: 15000 },
  confidence: "verified",
  coverage: "complete",
  value: { nav: 1.02, previousNav: 1, disagreement: false },
};

const rule = {
  id: "nav-ceiling",
  version: 1,
  name: "NAV ceiling",
  field: "nav",
  operator: "greater_than",
  threshold: 1.05,
  nearThresholdPercent: 5,
  severity: "high",
  recommendedAction: "Review valuation evidence.",
};

test("threshold rule returns pass, review, and breach deterministically", () => {
  assert.equal(evaluateRule(rule, evidence).status, "review");
  assert.equal(evaluateRule(rule, { ...evidence, value: { nav: 0.9 } }).status, "pass");
  assert.equal(evaluateRule(rule, { ...evidence, value: { nav: 1.06 } }).status, "breach");
  assert.deepEqual(evaluateRule(rule, evidence), evaluateRule(rule, evidence));
});

test("missing, stale, unavailable, or disagreeing evidence returns unknown", () => {
  assert.equal(evaluateRule(rule, null).status, "unknown");
  assert.equal(evaluateRule(rule, { ...evidence, state: "stale" }).status, "unknown");
  assert.equal(evaluateRule(rule, { ...evidence, state: "unavailable" }).status, "unknown");
  assert.equal(evaluateRule(rule, { ...evidence, state: "disagreement" }).status, "unknown");
});

test("supports equality, percentage change, freshness, and disagreement", () => {
  const eq = { ...rule, operator: "equals", threshold: "AuthorityA", field: "authority", nearThresholdPercent: 0 };
  assert.equal(evaluateRule(eq, { ...evidence, value: { authority: "AuthorityB" } }).status, "breach");

  const pct = { ...rule, operator: "percent_change_greater_than", threshold: 5, field: "nav", previousField: "previousNav" };
  assert.equal(evaluateRule(pct, { ...evidence, value: { nav: 1.06, previousNav: 1 } }).status, "breach");

  const fresh = { ...rule, operator: "freshness_greater_than", threshold: 500 };
  assert.equal(evaluateRule(fresh, evidence).status, "breach");

  const disagree = { ...rule, operator: "source_disagreement", threshold: true, field: "disagreement" };
  assert.equal(evaluateRule(disagree, { ...evidence, value: { disagreement: true } }).status, "breach");
});

test("rejects executable or unsupported rule input", () => {
  for (const field of ["process.exit()", "nav; DROP TABLE rules", "nav && shell"]) {
    const result = validateRule({ ...rule, field });
    assert.equal(result.valid, false);
  }
  assert.equal(validateRule({ ...rule, operator: "javascript" }).valid, false);
});

test("explains a rule in plain language", () => {
  assert.equal(summarizeRule(rule), "Breach when nav is greater than 1.05. Review within 5% of the threshold.");
});
