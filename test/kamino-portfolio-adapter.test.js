import test from "node:test";
import assert from "node:assert/strict";
import { createKaminoPortfolioAdapter } from "../subapps/kamino-monitor/kamino-portfolio-adapter.js";

test("Kamino adapter normalizes legacy position with numeric manifest metadata", async () => {
  const adapter = createKaminoPortfolioAdapter({ inspector: { inspect: async wallet => ({ position: { asset: "USDG", totalShares: "10", vault: "vault-1", name: "Legacy" }, sourceStatus: "kamino_api_plus_solana_rpc" }) } });
  const result = await adapter.discover("883AnESJiUVzCnwowgaWCpXp4EGsK4JMVzUUUcjSSs62", { discoveryAdapterId: "kamino", discoveryAdapterVersion: 1, targetIds: ["target-1"] });
  assert.deepEqual(result.position, { targetId: "target-1", protocol: "kamino", adapterId: "kamino", adapterVersion: 1, display: "Legacy", details: { asset: "USDG", totalShares: "10", vault: "vault-1" } });
});

test("Kamino adapter maps every discovered canonical vault position", async () => {
  const targets = [
    { id: "target-commodity", address: "B5pjfZAiKjyUEuqB2694NHrsjcaM67uuJaWqjzTVtzR6", name: "Institutional Commodity Yield" },
    { id: "target-steakhouse", address: "BoZDRc1RDY9FzUZZ19WT4GbtTnnbXQ8AGSU5ByEw3ut5", name: "Steakhouse USDG" },
  ];
  let calls = 0;
  const adapter = createKaminoPortfolioAdapter({ inspector: { inspect: async () => { throw new Error("legacy_path_must_not_run"); }, discoverPositions: async (_wallet, received) => { calls++; assert.deepEqual(received, targets); return { positions: targets.map((target, index) => ({ vault: target.address, totalShares: String(index + 1), tokensPerShare: "2", underlyingAmount: String((index + 1) * 2), apy7d: "0.1" })) }; } } });
  const result = await adapter.discover("883AnESJiUVzCnwowgaWCpXp4EGsK4JMVzUUUcjSSs62", { discoveryAdapterId: "kamino", discoveryAdapterVersion: 1, targets, targetIds: targets.map(target => target.id) });
  assert.equal(calls, 1);
  assert.deepEqual(result.positions.map(position => ({ targetId: position.targetId, display: position.display, details: position.details })), [
    { targetId: "target-commodity", display: "Institutional Commodity Yield", details: { vault: targets[0].address, totalShares: "1", tokensPerShare: "2", underlyingAmount: "2", apy7d: "0.1" } },
    { targetId: "target-steakhouse", display: "Steakhouse USDG", details: { vault: targets[1].address, totalShares: "2", tokensPerShare: "2", underlyingAmount: "4", apy7d: "0.1" } },
  ]);
});
