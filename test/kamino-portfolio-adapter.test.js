import test from "node:test";
import assert from "node:assert/strict";
import { createKaminoPortfolioAdapter } from "../subapps/kamino-monitor/kamino-portfolio-adapter.js";

test("Kamino adapter normalizes legacy position with stable metadata", async () => {
  const adapter = createKaminoPortfolioAdapter({ inspector: { inspect: async wallet => ({ position: { asset: "USDG", totalShares: "10", vault: "vault-1", name: "Legacy" }, sourceStatus: "kamino_api_plus_solana_rpc" }) } });
  const result = await adapter.discover("883AnESJiUVzCnwowgaWCpXp4EGsK4JMVzUUUcjSSs62", { discoveryAdapterId: "kamino", discoveryAdapterVersion: "1.0.0", targetIds: ["target-1"] });
  assert.deepEqual(result.position, { targetId: "target-1", protocol: "kamino", adapterId: "kamino", adapterVersion: "1.0.0", display: "Legacy", details: { asset: "USDG", totalShares: "10", vault: "vault-1" } });
});
