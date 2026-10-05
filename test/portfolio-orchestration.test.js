import test from "node:test";
import assert from "node:assert/strict";
import { createPortfolioOrchestrator } from "../subapps/kamino-monitor/portfolio-orchestrator.js";

const WALLET = "883AnESJiUVzCnwowgaWCpXp4EGsK4JMVzUUUcjSSs62";
const config = { policyRevision: "rev-1", protocols: [{ discoveryAdapterId: "kamino", discoveryAdapterVersion: "1.0.0", targetIds: ["target-1"] }] };
const position = { protocol: "Kamino Earn", asset: "USDG", totalShares: "10" };
const receipts = [{ targetId: "target-1", policyRevision: "rev-1", result: "pass", receiptId: "r-1" }];
function fakeFetch(url, options) {
  const body = JSON.parse(options.body);
  if (url.endsWith("/internal/v1/config/batch-read")) return Promise.resolve(new Response(JSON.stringify(config), { status: 200 }));
  if (url.endsWith("/internal/evaluation-receipts/batch-read")) return Promise.resolve(new Response(JSON.stringify({ receipts }), { status: 200 }));
  throw new Error(`unexpected ${url} ${JSON.stringify(body)}`);
}

test("orchestrates active Kamino position with matching latest receipt", async () => {
  const orchestrator = createPortfolioOrchestrator({ configUrl: "http://config", receiptsUrl: "http://receipts", token: "x".repeat(32), fetchImpl: fakeFetch, adapters: { "kamino@1.0.0": { discover: async () => ({ position }) } } });
  const result = await orchestrator.getPortfolio(WALLET);
  assert.deepEqual(result, { policyRevision: "rev-1", positions: [position], safeguards: [{ targetId: "target-1", result: "pass", receiptId: "r-1" }], protocolStatuses: [{ protocol: "kamino", status: "active" }], coverage: { state: "complete" } });
});
