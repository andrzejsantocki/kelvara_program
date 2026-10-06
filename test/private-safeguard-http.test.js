import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createKaminoMonitorServer } from "../subapps/kamino-monitor/server.js";

const WALLET = "11111111111111111111111111111111";
const OTHER = "22222222222222222222222222222222";
const tokenFor = wallet => `session-${wallet}`;
const portfolio = (wallet, authenticatedWallet, fail = false) => ({
  wallet,
  positions: [{ targetId: "target-a", safeguards: [{ bindingId: "global-binding", result: "pass" }, ...(authenticatedWallet === wallet ? [{ bindingId: "private-binding", result: fail ? "unknown" : "fail" }] : [])] }]
});

async function withApp({ getPortfolio = (wallet, options) => portfolio(wallet, options.authenticatedWallet) } = {}, run) {
  const walletAuth = { authorize(token) { if (token === tokenFor(WALLET)) return WALLET; if (token === tokenFor(OTHER)) return OTHER; throw new Error("authentication_required"); } };
  const app = createKaminoMonitorServer({ inspector: { inspect: async () => ({}) }, walletAuth, portfolioOrchestrator: { getPortfolio } });
  app.listen(0, "127.0.0.1"); await once(app, "listening");
  try { await run(`http://127.0.0.1:${app.address().port}`); } finally { app.close(); await once(app, "close"); }
}

test("authenticated owner receives global and private safeguards", async () => withApp({}, async base => {
  const response = await fetch(`${base}/api/portfolio/${WALLET}`, { headers: { authorization: `Bearer ${tokenFor(WALLET)}` } });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).positions[0].safeguards.map(x => x.bindingId), ["global-binding", "private-binding"]);
}));

test("public address inspection exposes global safeguards only", async () => withApp({}, async base => {
  const body = await fetch(`${base}/api/portfolio/${WALLET}`).then(r => r.json());
  assert.deepEqual(body.positions[0].safeguards.map(x => x.bindingId), ["global-binding"]);
  assert.equal(JSON.stringify(body).includes("private-binding"), false);
}));

test("wrong token cannot request private projection", async () => withApp({}, async base => {
  const body = await fetch(`${base}/api/portfolio/${WALLET}`, { headers: { authorization: `Bearer ${tokenFor(OTHER)}` } }).then(r => r.json());
  assert.deepEqual(body.positions[0].safeguards.map(x => x.bindingId), ["global-binding"]);
}));

test("private safeguard timeout fails closed as unknown", async () => withApp({ getPortfolio: async wallet => portfolio(wallet, wallet, true) }, async base => {
  const response = await fetch(`${base}/api/portfolio/${WALLET}`, { headers: { authorization: `Bearer ${tokenFor(WALLET)}` } });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).positions[0].safeguards[1].result, "unknown");
}));
