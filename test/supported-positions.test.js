import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { createControlPlaneClient } from "../subapps/kamino-monitor/portfolio-orchestrator.js";
import { createKaminoMonitorServer } from "../subapps/kamino-monitor/server.js";
import { createPortfolioOrchestrator } from "../subapps/kamino-monitor/portfolio-orchestrator.js";

const SECOND = "B5pjfZAiKjyUEuqB2694NHrsjcaM67uuJaWqjzTVtzR6";
const catalog = (network = "mainnet-beta") => ({ network, positions: [
  { targetId: `solana:${network}:kamino:kvault:9ceRgz579BcfWogs3RE11FKNQaWW7Lmtnev3MXspxUjF`, chain: "solana", network, protocolId: "kamino", resourceType: "kvault", address: "9ceRgz579BcfWogs3RE11FKNQaWW7Lmtnev3MXspxUjF", displayName: "Vault One", token: { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: null }, shareMint: "2bnxGUrAevL2i9zYtJWwPnAE2RmiPpRxjYnwv886DGCC", metricsAdapter: { id: "kamino-kvault-metrics", version: 1 }, monitoring: { state: "ready", activeRuleCount: 2 }, tvl: { state: "unavailable", value: null, currency: "USD", observedAt: null, source: "control-plane" } },
  { targetId: `solana:${network}:kamino:kvault:${SECOND}`, chain: "solana", network, protocolId: "kamino", resourceType: "kvault", address: SECOND, displayName: "Vault B5", token: { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC" }, shareMint: "2bnxGUrAevL2i9zYtJWwPnAE2RmiPpRxjYnwv886DGCC", metricsAdapter: { id: "kamino-kvault-metrics", version: 1 }, monitoring: { state: "provisioning", activeRuleCount: 1 }, tvl: { state: "unknown", value: null, currency: "USD", observedAt: null, source: "control-plane" } }
] });

async function withServer(controlPlaneClient, fn) {
  const server = createKaminoMonitorServer({ portfolioOrchestrator: createPortfolioOrchestrator({ controlPlaneClient, observationHubClient: {} }) });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  try { return await fn(`http://127.0.0.1:${server.address().port}`); } finally { server.close(); await once(server, "close"); }
}

test("serialized supported positions route returns bounded catalog including onboarding and unavailable TVL", async () => {
  await withServer({ readSupportedPositions: async network => catalog(network) }, async base => {
    const response = await fetch(`${base}/api/supported-positions?network=mainnet-beta`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body, catalog());
    assert.equal(body.positions[1].address, SECOND);
    assert.equal(body.positions[0].tvl.value, null);
    assert.equal(Object.hasOwn(body.positions[0], "private"), false);
  });
});

test("supported positions enforces selected network and never falls back", async () => {
  await withServer({ readSupportedPositions: async () => catalog("devnet") }, async base => {
    const response = await fetch(`${base}/api/supported-positions?network=mainnet-beta`);
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: "control_plane_network_mismatch" });
  });
});

test("catalog rejects boundary-invalid fields and unsupported lifecycle states", async () => {
  const cases = [
    ["too many positions", body => { body.positions = Array.from({ length: 101 }, () => body.positions[0]); }],
    ["activeRuleCount zero", body => { body.positions[0].monitoring.activeRuleCount = 0; }],
    ["invalid metrics version", body => { body.positions[0].metricsAdapter.version = Number.MAX_SAFE_INTEGER + 1; }],
    ["invalid share mint", body => { body.positions[0].shareMint = "not-a-solana-address"; }],
    ["wrong target identity", body => { body.positions[0].targetId = "solana:mainnet-beta:other:kvault:one"; }],
    ["unsupported monitoring state", body => { body.positions[0].monitoring.state = "retired"; }],
    ["current TVL without value", body => { body.positions[0].tvl.state = "current"; }],
    ["unknown TVL with value", body => { body.positions[0].tvl.value = "1.0"; }],
    ["non-canonical observedAt", body => { body.positions[0].tvl.state = "current"; body.positions[0].tvl.value = "1"; body.positions[0].tvl.observedAt = "2025-01-01"; }],
    ["control character", body => { body.positions[0].displayName = "Vault\nOne"; }],
  ];
  for (const [name, mutate] of cases) await assert.rejects(
    () => createPortfolioOrchestrator({ controlPlaneClient: { readSupportedPositions: async () => { const body = structuredClone(catalog()); mutate(body); return body; } }, observationHubClient: {} }).getSupportedPositions("mainnet-beta"),
    /control_plane_malformed/, name,
  );
});

test("production Control Plane client uses scoped token, exact endpoint, timeout, malformed-body failure", async () => {
  const requests = [];
  const client = createControlPlaneClient({ url: "http://control-plane.example/base", token: "x".repeat(32), fetchImpl: async (url, options) => {
    requests.push({ url, options });
    return { ok: true, json: async () => catalog() };
  } });
  await client.readSupportedPositions("mainnet-beta");
  assert.equal(requests[0].url, "http://control-plane.example/internal/v1/config/supported-positions?network=mainnet-beta");
  assert.equal(requests[0].options.headers.authorization, `Bearer ${"x".repeat(32)}`);
  assert.ok(requests[0].options.signal);
  await assert.rejects(() => createControlPlaneClient({ url: "http://control-plane.example", token: "x".repeat(32), fetchImpl: async () => ({ ok: true, json: async () => { throw new Error("bad json"); } }) }).readSupportedPositions("mainnet-beta"), /control_plane_malformed/);
});

test("malformed or unavailable Control Plane catalog is explicit 502", async () => {
  for (const controlPlaneClient of [
    { readSupportedPositions: async () => ({ network: "mainnet-beta", positions: [{}] }) },
    { readSupportedPositions: async () => { throw new Error("control_plane_unavailable"); } },
  ]) await withServer(controlPlaneClient, async base => {
    const response = await fetch(`${base}/api/supported-positions?network=mainnet-beta`);
    assert.equal(response.status, 502);
    assert.match((await response.json()).error, /^control_plane_/);
  });
});
