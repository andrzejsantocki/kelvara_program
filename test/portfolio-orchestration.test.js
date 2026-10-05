import test from "node:test";
import assert from "node:assert/strict";
import { createPortfolioOrchestrator, createControlPlaneClient, createObservationHubClient } from "../subapps/kamino-monitor/portfolio-orchestrator.js";

const WALLET = "883AnESJiUVzCnwowgaWCpXp4EGsK4JMVzUUUcjSSs62";
const manifest = { policyRevision: 7, protocols: [{ id: "protocol-kamino", name: "Kamino", chain: "solana", status: "active", discoveryAdapterId: "kamino", discoveryAdapterVersion: 1 }], targets: [{ id: "target-1", protocolId: "protocol-kamino", kind: "position", name: "Kamino position", status: "active" }] };
const config = { policyRevision: 7, protocols: [{ id: "protocol-kamino", name: "Kamino", chain: "solana", status: "active", discoveryAdapterId: "kamino", discoveryAdapterVersion: 1, targetIds: ["target-1"] }], targets: [{ id: "target-1", protocolId: "protocol-kamino", kind: "position", name: "Kamino position", status: "active" }], bindings: [{ bindingId: "binding-1", targetId: "target-1", ruleId: "rule-1", ruleVersion: 3, display: { name: "Kamino" } }], ruleVersions: [{ ruleId: "rule-1", version: 3, evaluatorType: "freshness", evaluatorVersion: "1", parameters: { maximumAgeMs: 60000 }, evidenceSchema: "fresh-v1", contentHash: "a".repeat(64) }] };
const position = { protocol: "Kamino Earn", asset: "USDG", totalShares: "10" };
const receipts = [{ receiptId: "r-1", idempotencyKey: "k-1", policyRevision: 7, ruleId: "rule-1", ruleVersion: 3, bindingId: "binding-1", targetId: "target-1", evidenceRefs: ["obs-1"], evaluatorVersion: "1", result: "pass", evaluatedAt: "2026-10-01T10:00:00.000Z", observedAt: "2026-10-01T09:59:00.000Z", provenance: { sourceId: "program-backend", schemaVersion: "receipt-v1", producerVersion: "1.0.0" } }];

function fakeFetch(url, options) {
  const body = JSON.parse(options.body);
  if (url.includes("/internal/v1/config/discovery-manifest")) return Promise.resolve(new Response(JSON.stringify(manifest), { status: 200 }));
  if (url.endsWith("/internal/v1/config/batch-read")) { assert.deepEqual(body, { targetIds: ["target-1"] }); return Promise.resolve(new Response(JSON.stringify(config), { status: 200 })); }
  if (url.endsWith("/internal/evaluation-receipts/batch-read")) { assert.deepEqual(body, { policyRevision: 7, targetIds: ["target-1"] }); return Promise.resolve(new Response(JSON.stringify({ policyRevision: 7, receipts }), { status: 200 })); }
  throw new Error(`unexpected ${url} ${JSON.stringify(body)}`);
}

test("clients send only kelvara-v2 batch-read fields", async () => {
  const calls = []; const urls = [];
  const fetchImpl = async (url, options) => { urls.push(String(url)); if (options.body) calls.push(JSON.parse(options.body)); return new Response(JSON.stringify({ policyRevision: 7, protocols: [], targets: [], bindings: [], receipts: [] }), { status: 200 }); };
  await createControlPlaneClient({ url: "http://config", token: "x".repeat(32), fetchImpl }).readActive(["t"]);
  await createObservationHubClient({ url: "http://receipts", token: "y".repeat(32), fetchImpl }).readLatest(["t"], 7);
  await createControlPlaneClient({ url: "http://config", token: "x".repeat(32), fetchImpl }).readManifest(WALLET);
  assert.deepEqual(calls, [{ targetIds: ["t"] }, { policyRevision: 7, targetIds: ["t"] }]);
  assert.equal(urls[2], "http://config/internal/v1/config/discovery-manifest");
});

test("orchestrates serialized Control Plane manifest and exact canonical targets", async () => {
  let received;
  const orchestrator = createPortfolioOrchestrator({ configUrl: "http://config", receiptsUrl: "http://receipts", token: "x".repeat(32), fetchImpl: fakeFetch, manifestClient: { read: async () => JSON.parse(JSON.stringify(manifest)) }, adapters: { "kamino@1": { discover: async (_wallet, protocol) => { received = protocol; return { position }; } } } });
  const result = await orchestrator.getPortfolio(WALLET);
  assert.deepEqual(received.targetIds, ["target-1"]); assert.deepEqual(received.targets, [manifest.targets[0]]);
  assert.equal(result.policyRevision, 7); assert.equal(result.coverage.state, "complete");
});

test("rejects manifest unknown fields, duplicate IDs, malformed adapter metadata, and zero usable graph", async () => {
  for (const bad of [
    { ...manifest, extra: true },
    { ...manifest, protocols: [...manifest.protocols, manifest.protocols[0]] },
    { ...manifest, protocols: [{ ...manifest.protocols[0], discoveryAdapterVersion: "1" }] },
    { ...manifest, targets: [] },
  ]) {
    const orchestrator = createPortfolioOrchestrator({ manifestClient: { read: async () => bad }, controlPlaneClient: { readActive: async () => config }, observationHubClient: { readLatest: async () => ({ policyRevision: 7, receipts }) }, adapters: {} });
    await assert.rejects(orchestrator.getPortfolio(WALLET), /control_plane_malformed|active_targets_unavailable/);
  }
});

test("rejects policy, relationship, and unadvertised batch mismatches", async () => {
  const cases = [
    { ...config, policyRevision: 8 },
    { ...config, protocols: [{ ...config.protocols[0], id: "other" }] },
    { ...config, targets: [{ ...config.targets[0], id: "other" }] },
    { ...config, targets: [{ ...config.targets[0], protocolId: "other" }] },
    { ...config, protocols: [...config.protocols, { ...config.protocols[0], id: "other" }] },
  ];
  for (const batch of cases) {
    const orchestrator = createPortfolioOrchestrator({ manifestClient: { read: async () => manifest }, controlPlaneClient: { readActive: async () => batch }, observationHubClient: { readLatest: async () => ({ policyRevision: 7, receipts }) }, adapters: {} });
    await assert.rejects(orchestrator.getPortfolio(WALLET), /control_plane_malformed/);
  }
});

test("missing exact receipt remains explicit unknown binding", async () => {
  const orchestrator = createPortfolioOrchestrator({ manifestClient: { read: async () => manifest }, controlPlaneClient: { readActive: async () => ({ ...config, bindings: [...config.bindings, { bindingId: "binding-2", targetId: "target-1", ruleId: "rule-2", ruleVersion: 1, display: { name: "Second" } }], ruleVersions: [...config.ruleVersions, { ruleId: "rule-2", version: 1, evaluatorType: "freshness", evaluatorVersion: "1", parameters: { maximumAgeMs: 60000 }, evidenceSchema: "fresh-v1", contentHash: "b".repeat(64) }] }) }, observationHubClient: { readLatest: async () => ({ policyRevision: 7, receipts }) }, adapters: {} });
  const result = await orchestrator.getPortfolio(WALLET);
  assert.equal(result.safeguards[1].result, "unknown"); assert.equal(result.coverage.state, "partial");
});

test("rejects empty, unknown-field, and malformed Observation Hub receipts", async () => {
  for (const response of [
    { policyRevision: 7, receipts: [] },
    { policyRevision: 7, receipts: [{ ...receipts[0], secret: "nope" }] },
    { policyRevision: 7, receipts: [{ ...receipts[0], targetId: "bad/id" }] },
    { policyRevision: 7, receipts: [{ ...receipts[0], evidenceRefs: [] }] },
  ]) {
    const orchestrator = createPortfolioOrchestrator({ manifestClient: { read: async () => manifest }, controlPlaneClient: { readActive: async () => config }, observationHubClient: { readLatest: async () => response }, adapters: {} });
    if (response.receipts.length === 0) { const result = await orchestrator.getPortfolio(WALLET); assert.equal(result.coverage.state, "partial"); }
    else await assert.rejects(orchestrator.getPortfolio(WALLET), /observation_hub_malformed/);
  }
});

test("rejects non-positive revisions and versions in serialized config", async () => {
  for (const bad of [{ ...config, policyRevision: 0 }, { ...config, protocols: [{ ...config.protocols[0], discoveryAdapterVersion: 0 }] }, { ...config, ruleVersions: [{ ...config.ruleVersions[0], version: 0 }] }]) {
    const orchestrator = createPortfolioOrchestrator({ manifestClient: { read: async () => manifest }, controlPlaneClient: { readActive: async () => bad }, observationHubClient: { readLatest: async () => ({ policyRevision: 7, receipts: [] }) }, adapters: {} });
    await assert.rejects(orchestrator.getPortfolio(WALLET), /control_plane_malformed/);
  }
});
