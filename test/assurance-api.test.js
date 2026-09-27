import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createApp } from "../src/platform/http/app.js";

const WALLET = "11111111111111111111111111111111";

test("assurance endpoint returns holder position and current protocol baseline", async () => {
  const app = createApp({
    inspectSource: () => ({}),
    getAssurance: async wallet => ({ wallet, position: { asset: "ONYC", amount: "10" }, assurance: { conclusion: "No monitored control condition is currently breached." } }),
  });
  app.listen(0, "127.0.0.1");
  await once(app, "listening");
  const { port } = app.address();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/wallets/${WALLET}/assurance`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.wallet, WALLET);
    assert.equal(body.position.asset, "ONYC");
    assert.match(body.assurance.conclusion, /No monitored control/);
  } finally { app.close(); await once(app, "close"); }
});

test("wallet without supported position returns 404", async () => {
  const app = createApp({ inspectSource: () => ({}), getAssurance: async () => { throw new Error("supported_position_not_found"); } });
  app.listen(0, "127.0.0.1");
  await once(app, "listening");
  const { port } = app.address();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/wallets/${WALLET}/assurance`);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "supported_position_not_found" });
  } finally { app.close(); await once(app, "close"); }
});
