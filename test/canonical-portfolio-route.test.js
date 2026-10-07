import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createKaminoMonitorServer } from "../subapps/kamino-monitor/server.js";

const wallet = "7sXHKv8RJG4ENmiDSpBEgiEnktJXPaVEmq2a8QBsvEgJ";
const commodity = "B5pjfZAiKjyUEuqB2694NHrsjcaM67uuJaWqjzTVtzR6";
const steakhouse = "BoZDRc1RDY9FzUZZ19WT4GbtTnnbXQ8AGSU5ByEw3ut5";
const target = (address, displayName) => ({ id: `solana:mainnet:kamino:kvault:${address}`, chain: "solana", network: "mainnet", protocolId: "kamino", resourceType: "kvault", address, displayName, status: "active", legacyAliases: [] });
const manifest = { policyRevision: 7, protocols: [{ id: "kamino", name: "Kamino", chain: "solana", status: "active", discoveryAdapterId: "kamino", discoveryAdapterVersion: 1 }], targets: [target(commodity, "Institutional Commodity Yield"), target(steakhouse, "Steakhouse USDG High Yield")] };
const config = { policyRevision: 7, protocols: [{ ...manifest.protocols[0], targetIds: manifest.targets.map(item => item.id) }], targets: manifest.targets, bindings: manifest.targets.map((item, index) => ({ bindingId: `binding-${index}`, targetId: item.id, ruleId: "rule-1", ruleVersion: 1, display: { name: item.displayName } })), ruleVersions: [{ ruleId: "rule-1", version: 1, evaluatorType: "freshness", evaluatorVersion: "1", evidenceSchema: "receipt-v1", contentHash: "a".repeat(64) }] };
const receipt = (index, result = "pass") => ({ receiptId: `receipt-${index}`, idempotencyKey: `key-${index}`, policyRevision: 7, ruleId: "rule-1", ruleVersion: 1, bindingId: `binding-${index}`, targetId: manifest.targets[index].id, evidenceRefs: [`obs-${index}`], evaluatorVersion: "1", result, evaluatedAt: "2026-10-01T10:00:00.000Z", observedAt: "2026-10-01T09:59:00.000Z", provenance: { sourceId: "observation-hub", schemaVersion: "receipt-v1", producerVersion: "1" } });

function fakeFetch(url, options = {}) {
  const body = options.body ? JSON.parse(options.body) : null;
  const headers = options.headers || {};
  assert.equal(headers.authorization, `Bearer ${url.includes("receipts") ? "observation-token-xxxxxxxxxxxxxxxx" : "control-token-xxxxxxxxxxxxxxxxxxxx"}`);
  if (url.endsWith("discovery-manifest")) return Promise.resolve(new Response(JSON.stringify(manifest)));
  if (url.endsWith("batch-read") && url.includes("config")) return Promise.resolve(new Response(JSON.stringify(config)));
  if (url.endsWith("batch-read") && url.includes("evaluation")) return Promise.resolve(new Response(JSON.stringify({ policyRevision: 7, receipts: [receipt(0), receipt(1)] })));
  throw new Error(`unexpected ${url} ${JSON.stringify(body)}`);
}

function start(orchestrator, walletAuth = { authorize: () => { throw new Error("not_authenticated"); } }) {
  const server = createKaminoMonitorServer({ portfolioOrchestrator: orchestrator, walletAuth, allowLegacyAuthForTests:true, pollMs: 3600000, inspector: { inspectControlPlane: async () => ({}) } });
  return new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(server)));
}

test("real HTTP portfolio route emits canonical two-vault positions and hides private safeguards", async () => {
  const { createPortfolioOrchestrator } = await import("../subapps/kamino-monitor/portfolio-orchestrator.js");
  const { createKaminoPortfolioAdapter } = await import("../subapps/kamino-monitor/kamino-portfolio-adapter.js");
  const orchestrator = createPortfolioOrchestrator({ configUrl: "http://config", receiptsUrl: "http://receipts", controlPlaneToken: "control-token-xxxxxxxxxxxxxxxxxxxx", observationHubToken: "observation-token-xxxxxxxxxxxxxxxx", fetchImpl: fakeFetch, adapters: { "kamino@1": createKaminoPortfolioAdapter({ inspector: { discoverPositions: async () => ({ positions: manifest.targets.map((item, i) => ({ vault: item.address, totalShares: String(i + 1), tokensPerShare: "2", underlyingAmount: String((i + 1) * 2), apy7d: "0.1" })) }) } }) } });
  const server = await start(orchestrator); try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/portfolio/${wallet}`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.positions.map(item => ({ targetId: item.targetId, chain: item.chain, network: item.network, protocolId: item.protocolId, resourceType: item.resourceType, address: item.address, displayName: item.displayName })), manifest.targets.map(item => ({ targetId: item.id, chain: item.chain, network: item.network, protocolId: item.protocolId, resourceType: item.resourceType, address: item.address, displayName: item.displayName })));
    assert.deepEqual(body.safeguards.map(item => item.scope), ["global", "global"]);
    assert(!JSON.stringify(body).includes("private"));
  } finally { server.close(); }
});

test("production route uses real authenticated Control Plane and Observation Hub HTTP servers", async () => {
  const { createPortfolioOrchestrator, createControlPlaneClient, createObservationHubClient } = await import("../subapps/kamino-monitor/portfolio-orchestrator.js");
  const controlToken = "control-token-xxxxxxxxxxxxxxxxxxxx", observationToken = "observation-token-xxxxxxxxxxxxxxxx";
  const seen = [];
  const readBody = async request => { let raw = ""; for await (const chunk of request) raw += chunk; return JSON.parse(raw || "{}"); };
  const control = createServer(async (request, response) => {
    assert.equal(request.headers.authorization, `Bearer ${controlToken}`); seen.push(`control:${request.method}:${request.url}`);
    if (request.method === "GET" && request.url === "/internal/v1/config/discovery-manifest") return response.end(JSON.stringify(manifest));
    assert.deepEqual(await readBody(request), { targetIds: manifest.targets.map(item => item.id) }); response.end(JSON.stringify(config));
  });
  const observation = createServer(async (request, response) => {
    assert.equal(request.headers.authorization, `Bearer ${observationToken}`); seen.push(`observation:${request.method}:${request.url}`);
    assert.deepEqual(await readBody(request), { policyRevision: 7, targetIds: manifest.targets.map(item => item.id) });
    response.end(JSON.stringify({ policyRevision: 7, receipts: [receipt(0), receipt(1)] }));
  });
  await Promise.all([new Promise(resolve => control.listen(0, "127.0.0.1", resolve)), new Promise(resolve => observation.listen(0, "127.0.0.1", resolve))]);
  const orchestrator = createPortfolioOrchestrator({
    controlPlaneClient: createControlPlaneClient({ url: `http://127.0.0.1:${control.address().port}`, token: controlToken }),
    observationHubClient: createObservationHubClient({ url: `http://127.0.0.1:${observation.address().port}`, token: observationToken }),
    adapters: { "kamino@1": { discover: async (_wallet, protocol) => ({ positions: protocol.targets.map(item => ({ targetId: item.id, protocol: "kamino", adapterId: "kamino", adapterVersion: 1, display: item.displayName, details: { vault: item.address, totalShares: "1" } })) }) } }
  });
  const route = await start(orchestrator); try {
    const response = await fetch(`http://127.0.0.1:${route.address().port}/api/portfolio/${wallet}`); assert.equal(response.status, 200);
    const body = await response.json(); assert.deepEqual(body.positions.map(item => item.targetId), manifest.targets.map(item => item.id));
    assert.deepEqual(seen, ["control:GET:/internal/v1/config/discovery-manifest", "control:POST:/internal/v1/config/batch-read", "observation:POST:/internal/evaluation-receipts/batch-read"]);
  } finally { await new Promise(resolve => route.close(resolve)); await new Promise(resolve => observation.close(resolve)); await new Promise(resolve => control.close(resolve)); }
});

test("display-name changes preserve canonical identity", async () => {
  const { createPortfolioOrchestrator } = await import("../subapps/kamino-monitor/portfolio-orchestrator.js");
  const renamed = structuredClone(manifest); renamed.targets[0].displayName = "RENAMED DISPLAY";
  const renamedConfig = { ...config, targets: renamed.targets, protocols: [{ ...config.protocols[0], targetIds: renamed.targets.map(item => item.id) }] };
  const orchestrator = createPortfolioOrchestrator({ manifestClient: { read: async () => renamed }, controlPlaneClient: { readActive: async () => renamedConfig }, observationHubClient: { readLatest: async () => ({ policyRevision: 7, receipts: [] }) }, adapters: { "kamino@1": { discover: async (_wallet, protocol) => ({ positions: protocol.targets.map(item => ({ targetId: item.id, protocol: "kamino", adapterId: "kamino", adapterVersion: 1, display: item.displayName, details: { vault: item.address, totalShares: "1" } })) }) } } });
  const result = await orchestrator.getPortfolio(wallet);
  assert.deepEqual(result.positions.map(item => item.targetId), manifest.targets.map(item => item.id));
});
