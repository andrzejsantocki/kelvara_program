import test from "node:test";
import assert from "node:assert/strict";
import { createPortfolioOrchestrator, createControlPlaneClient, createObservationHubClient } from "../subapps/kamino-monitor/portfolio-orchestrator.js";

const WALLET = "883AnESJiUVzCnwowgaWCpXp4EGsK4JMVzUUUcjSSs62";
const manifest = { policyRevision: 7, protocols: [{ id: "protocol-kamino", name: "Kamino", chain: "solana", status: "active", discoveryAdapterId: "kamino", discoveryAdapterVersion: 1 }], targets: [{ id: "target-1", protocolId: "protocol-kamino", kind: "position", name: "Kamino position", status: "active", address: "vault-1" }] };
// Copied Control Plane producer response: ruleVersions intentionally omit parameters.
const config = { policyRevision: 7, protocols: [{ id: "protocol-kamino", name: "Kamino", chain: "solana", status: "active", discoveryAdapterId: "kamino", discoveryAdapterVersion: 1, targetIds: ["target-1"] }], targets: [{ id: "target-1", protocolId: "protocol-kamino", kind: "position", name: "Kamino position", status: "active", address: "vault-1" }], bindings: [{ bindingId: "binding-1", targetId: "target-1", ruleId: "rule-1", ruleVersion: 3, display: { name: "Kamino" } }], ruleVersions: [{ ruleId: "rule-1", version: 3, evaluatorType: "freshness", evaluatorVersion: "1", evidenceSchema: "fresh-v1", contentHash: "a".repeat(64) }] };
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

test("orchestrates two real Kamino targets with human-readable binding names", async () => {
  const twoTargetManifest = { ...manifest, targets: [
    { id: "target-commodity", protocolId: "protocol-kamino", kind: "position", name: "Institutional Commodity Yield", address: "B5pjfZAiKjyUEuqB2694NHrsjcaM67uuJaWqjzTVtzR6", status: "active" },
    { id: "target-steakhouse", protocolId: "protocol-kamino", kind: "position", name: "Steakhouse USDG High Yield", address: "BoZDRc1RDY9FzUZZ19WT4GbtTnnbXQ8AGSU5ByEw3ut5", status: "active" },
  ] };
  const twoTargetConfig = { ...config, protocols: [{ ...config.protocols[0], targetIds: ["target-commodity", "target-steakhouse"] }], targets: twoTargetManifest.targets, bindings: [
    { bindingId: "binding-commodity", targetId: "target-commodity", ruleId: "rule-1", ruleVersion: 3, display: { name: "Institutional Commodity Yield" } },
    { bindingId: "binding-steakhouse", targetId: "target-steakhouse", ruleId: "rule-1", ruleVersion: 3, display: { name: "Steakhouse USDG High Yield" } },
  ] };
  const orchestrator = createPortfolioOrchestrator({ manifestClient: { read: async () => twoTargetManifest }, controlPlaneClient: { readActive: async () => twoTargetConfig }, observationHubClient: { readLatest: async () => ({ policyRevision: 7, receipts: [] }) }, adapters: { "kamino@1": { discover: async (_wallet, protocol) => ({ positions: protocol.targets.map(target => ({ targetId: target.id, protocol: "kamino", adapterId: "kamino", adapterVersion: 1, display: target.name, details: { vault: target.address, totalShares: "1" } })) }) } } });
  const result = await orchestrator.getPortfolio(WALLET);
  assert.deepEqual(result.positions.map(item => item.targetId), ["target-commodity", "target-steakhouse"]);
  assert.deepEqual(result.positions.map(item => item.display), ["Institutional Commodity Yield", "Steakhouse USDG High Yield"]);
});

test("orchestrates multiple positions and restricts safeguards to discovered targets", async () => {
  const multiManifest = { ...manifest, targets: [
    { id: "target-1", protocolId: "protocol-kamino", kind: "position", name: "Commodity", address: "vault-1", status: "active" },
    { id: "target-2", protocolId: "protocol-kamino", kind: "position", name: "Steakhouse", address: "vault-2", status: "active" },
    { id: "target-3", protocolId: "protocol-kamino", kind: "position", name: "Unrelated", address: "vault-3", status: "active" },
  ] };
  const multiConfig = { ...config, protocols: [{ ...config.protocols[0], targetIds: ["target-1", "target-2", "target-3"] }], targets: multiManifest.targets, bindings: [
    { bindingId: "binding-1", targetId: "target-1", ruleId: "rule-1", ruleVersion: 3, display: { name: "Commodity" } },
    { bindingId: "binding-2", targetId: "target-2", ruleId: "rule-1", ruleVersion: 3, display: { name: "Steakhouse" } },
    { bindingId: "binding-3", targetId: "target-3", ruleId: "rule-1", ruleVersion: 3, display: { name: "Unrelated" } },
  ] };
  const orchestrator = createPortfolioOrchestrator({ manifestClient: { read: async () => multiManifest }, controlPlaneClient: { readActive: async () => multiConfig }, observationHubClient: { readLatest: async () => ({ policyRevision: 7, receipts: [] }) }, adapters: { "kamino@1": { discover: async (_wallet, protocol) => ({ positions: protocol.targets.slice(0, 2).map(target => ({ targetId: target.id, protocol: "kamino", adapterId: "kamino", adapterVersion: 1, display: target.name, details: { vault: target.address, totalShares: "1" } })) }) } } });
  const result = await orchestrator.getPortfolio(WALLET);
  assert.deepEqual(result.positions.map(item => item.targetId), ["target-1", "target-2"]);
  assert.deepEqual(result.safeguards.map(item => item.targetId), ["target-1", "target-2"]);
  assert.equal(result.safeguards[0].result, "unknown");
  assert.equal(result.coverage.expected, 2);
});

test("missing exact receipt remains explicit unknown binding", async () => {
  const orchestrator = createPortfolioOrchestrator({ manifestClient: { read: async () => manifest }, controlPlaneClient: { readActive: async () => ({ ...config, bindings: [...config.bindings, { bindingId: "binding-2", targetId: "target-1", ruleId: "rule-2", ruleVersion: 1, display: { name: "Second" } }], ruleVersions: [...config.ruleVersions, { ruleId: "rule-2", version: 1, evaluatorType: "freshness", evaluatorVersion: "1", evidenceSchema: "fresh-v1", contentHash: "b".repeat(64) }] }) }, observationHubClient: { readLatest: async () => ({ policyRevision: 7, receipts }) }, adapters: { "kamino@1": { discover: async () => ({ position: { targetId: "target-1", protocol: "kamino", adapterId: "kamino", adapterVersion: 1, display: "Kamino", details: { vault: "vault-1" } } }) } } });
  const result = await orchestrator.getPortfolio(WALLET);
  assert.equal(result.safeguards[1].result, "unknown"); assert.equal(result.coverage.state, "partial");
});

test("rejects empty, unknown-field, and malformed Observation Hub receipts", async () => {
  const discovering = { "kamino@1": { discover: async () => ({ position: { targetId: "target-1", protocol: "kamino", adapterId: "kamino", adapterVersion: 1, display: "Kamino", details: { vault: "vault-1" } } }) } };
  for (const response of [
    { policyRevision: 7, receipts: [] },
    { policyRevision: 7, receipts: [{ ...receipts[0], secret: "nope" }] },
    { policyRevision: 7, receipts: [{ ...receipts[0], targetId: "bad/id" }] },
    { policyRevision: 7, receipts: [{ ...receipts[0], evidenceRefs: [] }] },
  ]) {
    const orchestrator = createPortfolioOrchestrator({ manifestClient: { read: async () => manifest }, controlPlaneClient: { readActive: async () => config }, observationHubClient: { readLatest: async () => response }, adapters: discovering });
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

test("rejects non-canonical timestamps and open or unbounded provenance", async () => {
  const discovering = { "kamino@1": { discover: async () => ({ position: { targetId: "target-1", protocol: "kamino", adapterId: "kamino", adapterVersion: 1, display: "Kamino", details: { vault: "vault-1" } } }) } };
  for (const badReceipt of [
    { ...receipts[0], evaluatedAt: "2026-02-30T10:00:00.000Z" },
    { ...receipts[0], observedAt: "2026-10-01T09:59:00+00:00" },
    { ...receipts[0], provenance: { ...receipts[0].provenance, extra: "nope" } },
    { ...receipts[0], provenance: { ...receipts[0].provenance, sourceId: "x".repeat(129) } },
  ]) {
    const orchestrator = createPortfolioOrchestrator({ manifestClient: { read: async () => manifest }, controlPlaneClient: { readActive: async () => config }, observationHubClient: { readLatest: async () => ({ policyRevision: 7, receipts: [badReceipt] }) }, adapters: discovering });
    await assert.rejects(orchestrator.getPortfolio(WALLET), /observation_hub_malformed/);
  }
});

test("rejects receipt identity mismatches and duplicate exact identities", async () => {
  const discovering = { "kamino@1": { discover: async () => ({ position: { targetId: "target-1", protocol: "kamino", adapterId: "kamino", adapterVersion: 1, display: "Kamino", details: { vault: "vault-1" } } }) } };
  const cases = [
    [{ ...receipts[0], bindingId: "unknown-binding" }],
    [{ ...receipts[0], targetId: "target-other" }],
    [{ ...receipts[0], ruleId: "rule-other" }],
    [{ ...receipts[0], policyRevision: 8 }],
    [receipts[0], { ...receipts[0], receiptId: "r-2", idempotencyKey: "k-2" }],
  ];
  for (const badReceipts of cases) {
    const orchestrator = createPortfolioOrchestrator({ manifestClient: { read: async () => manifest }, controlPlaneClient: { readActive: async () => config }, observationHubClient: { readLatest: async () => ({ policyRevision: 7, receipts: badReceipts }) }, adapters: discovering });
    await assert.rejects(orchestrator.getPortfolio(WALLET), /observation_hub_malformed/);
  }
});
