import test from "node:test";
import assert from "node:assert/strict";
import { createKaminoPortfolioAdapter } from "../subapps/kamino-monitor/kamino-portfolio-adapter.js";

test("Kamino adapter delegates discovery to the existing inspector", async () => {
  const calls = [];
  const adapter = createKaminoPortfolioAdapter({ inspector: { inspect: async wallet => { calls.push(wallet); return { position: { asset: "USDG" } }; } } });
  assert.deepEqual(await adapter.discover("883AnESJiUVzCnwowgaWCpXp4EGsK4JMVzUUUcjSSs62"), { position: { asset: "USDG" } });
  assert.equal(calls.length, 1);
});
