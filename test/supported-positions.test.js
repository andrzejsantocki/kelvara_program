import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createKaminoMonitorServer } from "../subapps/kamino-monitor/server.js";
import { createPortfolioOrchestrator } from "../subapps/kamino-monitor/portfolio-orchestrator.js";

const SECOND = "B5pjfZAiKjyUEuqB2694NHrsjcaM67uuJaWqjzTVtzR6";
const catalog = (network = "mainnet-beta") => ({ network, positions: [
  { targetId: `solana:${network}:kamino:kvault:one`, chain: "solana", network, protocolId: "kamino", resourceType: "kvault", address: "9ceRgz579BcfWogs3RE11FKNQaWW7Lmtnev3MXspxUjF", displayName: "Vault One", token: { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: null }, shareMint: "2bnxGUrAevL2i9zYtJWwPnAE2RmiPpRxjYnwv886DGCC", metricsAdapter: { id: "kamino-kvault-metrics", version: 1 }, monitoring: { state: "ready", activeRuleCount: 2 }, tvl: { state: "unavailable", value: null, currency: "USD", observedAt: null, source: "control-plane" } },
  { targetId: `solana:${network}:kamino:kvault:${SECOND}`, chain: "solana", network, protocolId: "kamino", resourceType: "kvault", address: SECOND, displayName: "Vault B5", token: { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC" }, shareMint: "2bnxGUrAevL2i9zYtJWwPnAE2RmiPpRxjYnwv886DGCC", metricsAdapter: { id: "kamino-kvault-metrics", version: 1 }, monitoring: { state: "provisioning", activeRuleCount: 0 }, tvl: { state: "unknown", value: null, currency: "USD", observedAt: null, source: "control-plane" } }
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
