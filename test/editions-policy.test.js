import test from "node:test";
import assert from "node:assert/strict";
import { getEditionCapabilities } from "../src/domains/editions/policy.js";

test("lite gives a holder immediate position assurance without pro internals", () => {
  assert.deepEqual(getEditionCapabilities("lite"), {
    walletDiscovery: true,
    positionSummary: true,
    currentMonitorStatus: true,
    retrospectiveRuleHistory: true,
    historicalNearThresholds: true,
    evidenceLinks: true,
    assistedExit: true,
    rawAccountMatrix: false,
    instructionAnalytics: false,
    customRules: false,
    apiExport: false,
  });
});

test("pro adds analyst tools without changing the holder truth model", () => {
  const lite = getEditionCapabilities("lite");
  const pro = getEditionCapabilities("pro");
  for (const [capability, enabled] of Object.entries(lite)) {
    if (enabled) assert.equal(pro[capability], true, capability);
  }
  assert.equal(pro.rawAccountMatrix, true);
  assert.equal(pro.instructionAnalytics, true);
  assert.equal(pro.customRules, true);
  assert.equal(pro.apiExport, true);
});

test("unknown edition is rejected", () => {
  assert.throws(() => getEditionCapabilities("enterprise"), /unknown edition/);
});
