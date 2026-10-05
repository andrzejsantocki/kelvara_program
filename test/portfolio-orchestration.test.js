import test from "node:test";
import assert from "node:assert/strict";
import { createPortfolioOrchestrator, createControlPlaneClient, createObservationHubClient } from "../subapps/kamino-monitor/portfolio-orchestrator.js";

const WALLET = "883AnESJiUVzCnwowgaWCpXp4EGsK4JMVzUUUcjSSs62";
const manifest = { policyRevision: 7, protocols: [{ discoveryAdapterId: "kamino", discoveryAdapterVersion: "1.0.0", targetIds: ["target-1"] }] };
const config = { policyRevision: 7, protocols: manifest.protocols, targets: [{ targetId: "target-1" }], bindings: [{ bindingId: "binding-1", targetId: "target-1", ruleId: "rule-1", ruleVersion: 3, display: "Kamino" }], ruleVersions: { "rule-1": 3 } };
const position = { protocol: "Kamino Earn", asset: "USDG", totalShares: "10" };
const receipts = [{ bindingId: "binding-1", targetId: "target-1", ruleId: "rule-1", ruleVersion: 3, policyRevision: 7, result: "pass", receiptId: "r-1" }];

function fakeFetch(url, options) {
  const body = JSON.parse(options.body);
  if (url.includes("/internal/v1/config/discovery-manifest")) return Promise.resolve(new Response(JSON.stringify(manifest), { status: 200 }));
  if (url.endsWith("/internal/v1/config/batch-read")) { assert.deepEqual(body, { targetIds: ["target-1"] }); return Promise.resolve(new Response(JSON.stringify(config), { status: 200 })); }
  if (url.endsWith("/internal/evaluation-receipts/batch-read")) { assert.deepEqual(body, { policyRevision: 7, targetIds: ["target-1"] }); return Promise.resolve(new Response(JSON.stringify({ receipts }), { status: 200 })); }
  throw new Error(`unexpected ${url} ${JSON.stringify(body)}`);
}

test("clients send only kelvara-v2 batch-read fields", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => { calls.push(JSON.parse(options.body)); return new Response(JSON.stringify({ policyRevision: 7, protocols: [], targets: [], bindings: [], receipts: [] }), { status: 200 }); };
  await createControlPlaneClient({ url: "http://config", token: "x".repeat(32), fetchImpl }).readActive(["t"]);
  await createObservationHubClient({ url: "http://receipts", token: "y".repeat(32), fetchImpl }).readLatest(["t"], 7);
  assert.deepEqual(calls, [{ targetIds: ["t"] }, { policyRevision: 7, targetIds: ["t"] }]);
});

test("orchestrates exact binding identity and expected-binding coverage", async () => {
  const orchestrator = createPortfolioOrchestrator({ configUrl: "http://config", receiptsUrl: "http://receipts", token: "x".repeat(32), fetchImpl: fakeFetch, manifestClient: { read: async () => manifest }, adapters: { "kamino@1.0.0": { discover: async () => ({ position }) } } });
  const result = await orchestrator.getPortfolio(WALLET);
  assert.deepEqual(result, { policyRevision: 7, positions: [position], safeguards: [{ bindingId: "binding-1", targetId: "target-1", ruleId: "rule-1", ruleVersion: 3, display: "Kamino", result: "pass", receiptId: "r-1" }], protocolStatuses: [{ protocol: "kamino", status: "available" }], coverage: { state: "complete", expected: 1, satisfied: 1 } });
});

test("missing exact receipt remains explicit unknown binding", async () => {
  const orchestrator = createPortfolioOrchestrator({ manifestClient: { read: async () => manifest }, controlPlaneClient: { readActive: async () => ({ ...config, bindings: [...config.bindings, { bindingId: "binding-2", targetId: "target-1", ruleId: "rule-2", ruleVersion: 1, display: "Second" }] }) }, observationHubClient: { readLatest: async () => ({ receipts }) }, adapters: {} });
  const result = await orchestrator.getPortfolio(WALLET);
  assert.equal(result.safeguards[1].result, "unknown"); assert.equal(result.safeguards[1].reason, "missing_receipt"); assert.equal(result.coverage.state, "partial");
});

test("closed response validation rejects unknown config fields", async () => {
  const orchestrator = createPortfolioOrchestrator({ manifestClient: { read: async () => manifest }, controlPlaneClient: { readActive: async () => ({ ...config, secret: "do-not-leak" }) }, observationHubClient: { readLatest: async () => ({ receipts }) }, adapters: {} });
  await assert.rejects(orchestrator.getPortfolio(WALLET), /control_plane_malformed/);
});
