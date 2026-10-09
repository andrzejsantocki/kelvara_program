import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createKaminoMonitorServer } from "../subapps/kamino-monitor/server.js";

const WALLET = "11111111111111111111111111111111";
const OTHER = "22222222222222222222222222222222";
const tokenFor = wallet => `session-${wallet}`;
const evidence = { schemaVersion: "observation-hub-governance/v1", freshness: { state: "fresh", observedAt: "2026-10-09T10:00:00.000Z", finalizedSlot: 123 }, wallets: [{ address: WALLET, vaults: [{ identity: { provider: "squads", generation: "v4", multisigAddress: "multi", vaultIndex: 0, vaultAddress: "vault" }, membership: { role: "member", permissions: ["vote"], threshold: 2, memberCount: 3 }, requiresAttention: [], currentActions: [], recentChanges: [], nextHistoryCursor: null }] }], warnings: [] };

async function withApp({ governanceQuery = async request => ({ ...evidence, request }) } = {}, run) {
  const walletAuth = { authorize(token) { if (token === tokenFor(WALLET)) return WALLET; if (token === tokenFor(OTHER)) return OTHER; throw new Error("authentication_required"); } };
  const app = createKaminoMonitorServer({ inspector: { inspect: async () => ({}) }, walletAuth, governanceQuery });
  app.listen(0, "127.0.0.1"); await once(app, "listening");
  try { await run(`http://127.0.0.1:${app.address().port}`); } finally { app.close(); await once(app, "close"); }
}

async function get(base, query = "network=mainnet-beta", token = tokenFor(WALLET)) {
  return fetch(`${base}/api/governance?${query}`, { headers: { authorization: `Bearer ${token}` } });
}

test("authenticated governance query uses session wallet and customer schema", async () => withApp({}, async base => {
  const response = await get(base);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.schemaVersion, "customer-governance/v1");
  assert.deepEqual(body.wallets.map(wallet => wallet.address), [WALLET]);
  assert.equal(JSON.stringify(body).includes("rawBytes"), false);
}));

test("missing, wrong, and expired authentication return 401 without upstream query", async () => {
  let calls = 0;
  await withApp({ governanceQuery: async () => { calls++; return evidence; } }, async base => {
    assert.equal((await fetch(`${base}/api/governance?network=mainnet-beta`)).status, 401);
    assert.equal((await get(base, "network=devnet")).status, 400);
    assert.equal((await get(base, "network=mainnet-beta", "expired")).status, 401);
  });
  assert.equal(calls, 0);
});

test("arbitrary wallet query parameter cannot expand session scope", async () => withApp({ governanceQuery: async request => { assert.deepEqual(request.walletAddresses, [WALLET]); return evidence; } }, async base => {
  const response = await get(base, "network=mainnet-beta&wallet=22222222222222222222222222222222");
  assert.equal(response.status, 200);
}));

test("history limit defaults to ten and rejects out of bounds while cursor passes opaquely", async () => {
  const seen = [];
  await withApp({ governanceQuery: async request => { seen.push(request); return evidence; } }, async base => {
    assert.equal((await get(base, "network=mainnet-beta&cursor=opaque%2Fcursor")).status, 200);
    assert.equal((await get(base, "network=mainnet-beta&history_limit=0")).status, 400);
    assert.equal((await get(base, "network=mainnet-beta&history_limit=101")).status, 400);
  });
  assert.equal(seen[0].historyLimitPerVault, 10);
  assert.equal(seen[0].historyCursor, "opaque/cursor");
});

test("upstream failure returns bounded unavailable state, not false empty", async () => withApp({ governanceQuery: async () => { throw new Error("observation_hub_timeout"); } }, async base => {
  const response = await get(base);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.freshness.state, "unavailable");
  assert.equal(body.wallets, undefined);
  assert.ok(body.warnings.length > 0);
}));
