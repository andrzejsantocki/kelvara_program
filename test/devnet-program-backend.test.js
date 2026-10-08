import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import nacl from "tweetnacl";
import { Keypair } from "@solana/web3.js";
import { createGenesisVerifier, createNetworkBoundWalletAuth, NETWORK_GENESIS } from "../subapps/kamino-monitor/network-session.js";
import { createKaminoMonitorServer } from "../subapps/kamino-monitor/server.js";

const keypair = Keypair.generate();
const wallet = keypair.publicKey.toString();
const otherKeypair = Keypair.generate();
const otherWallet = otherKeypair.publicKey.toString();

async function fakeRpcServer({ response = NETWORK_GENESIS.devnet, delay = 0, status = 200 } = {}) {
  const calls = [];
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    calls.push(JSON.parse(raw));
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, result: response });
    res.writeHead(status, { "content-type": "application/json", "content-length": String(Buffer.byteLength(body)) });
    res.end(body);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return { server, calls, url: `http://127.0.0.1:${server.address().port}` };
}

async function setup({withOperations = false} = {}) {
  const rpc = await fakeRpcServer();
  const calls = { inspect: 0, store: 0, operations: 0, prepare: 0, finalize: 0 };
  const auth = createNetworkBoundWalletAuth({ genesisVerifier: createGenesisVerifier({ network: "devnet", rpcUrl: rpc.url, timeoutMs: 100 }) });
  const protectionStore = {
    async get() { calls.store++; return null; },
    async save() { calls.store++; },
    async remove() { calls.store++; },
  };
  const server = createKaminoMonitorServer({
    networkAuth: { authFor(network) { if (network !== "devnet") throw new Error("network_verification_unavailable"); return auth; } },
    inspector: { inspect: async () => { calls.inspect++; throw new Error("mainnet_inspector_called"); }, inspectControlPlane: async () => ({}) },
    protectionStore,
    operationsSink: withOperations ? { async record() { calls.operations++; } } : null,
    prepareEvacuationImpl: async () => { calls.prepare++; throw new Error("prepare_called"); },
    finalizeManualEvacuation: async () => { calls.finalize++; throw new Error("finalize_called"); },
    pollMs: 3600000,
  });
  server.calls = calls;
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return { rpc, auth, server, base: `http://127.0.0.1:${server.address().port}` };
}

async function closeAll({ rpc, server }) { await new Promise(resolve => server.close(resolve)); await new Promise(resolve => rpc.server.close(resolve)); }
async function json(response) { return response.json(); }

async function authenticate(base) {
  const headers = { "content-type": "application/json", "x-kelvara-network": "devnet" };
  const challengeResponse = await fetch(`${base}/api/auth/challenge`, { method: "POST", headers, body: JSON.stringify({ wallet, network: "devnet" }) });
  assert.equal(challengeResponse.status, 200);
  const challenge = await json(challengeResponse);
  const signature = Buffer.from(nacl.sign.detached(Buffer.from(challenge.message), keypair.secretKey)).toString("base64");
  const verifyResponse = await fetch(`${base}/api/auth/verify`, { method: "POST", headers, body: JSON.stringify({ wallet, network: "devnet", message: challenge.message, signature }) });
  assert.equal(verifyResponse.status, 200);
  return { ...(await json(verifyResponse)), genesisHash: challenge.genesisHash };
}

test("production HTTP Devnet auth verifies canonical genesis, including empty wallet", async () => {
  const ctx = await setup();
  try {
    const session = await authenticate(ctx.base);
    assert.equal(session.network, "devnet");
    assert.equal(session.genesisHash, NETWORK_GENESIS.devnet);
    assert.ok(ctx.rpc.calls.every(call => call.method === "getGenesisHash"));
  } finally { await closeAll(ctx); }
});

test("Devnet portfolio is authenticated, canonical empty, and isolated from Mainnet discovery", async () => {
  const ctx = await setup();
  try {
    const session = await authenticate(ctx.base);
    const response = await fetch(`${ctx.base}/api/portfolio/${wallet}`, { headers: { authorization: `Bearer ${session.token}`, "x-kelvara-network": "devnet", "x-kelvara-genesis": NETWORK_GENESIS.devnet } });
    assert.equal(response.status, 200);
    assert.deepEqual(await json(response), { network: "devnet", genesisHash: NETWORK_GENESIS.devnet, sourceStatus: "canonical_devnet_empty_read_only", positions: [], safeguards: [], protocolStatuses: [] });
  } finally { await closeAll(ctx); }
});

test("Devnet inspect is empty read-only and makes zero Mainnet inspector calls", async () => {
  const ctx = await setup();
  try {
    const session = await authenticate(ctx.base);
    const response = await fetch(`${ctx.base}/api/inspect/${wallet}`, { headers: { authorization: `Bearer ${session.token}`, "x-kelvara-network": "devnet", "x-kelvara-genesis": NETWORK_GENESIS.devnet } });
    assert.equal(response.status, 200);
    assert.deepEqual(await json(response), { network: "devnet", genesisHash: NETWORK_GENESIS.devnet, wallet, position: null, authority: null, sourceStatus: "canonical_devnet_empty_read_only" });
  } finally { await closeAll(ctx); }
});

test("Devnet action rejects before downstream side effects", async () => {
  const ctx = await setup();
  try {
    const session = await authenticate(ctx.base);
    const response = await fetch(`${ctx.base}/api/evacuation/prepare`, { method: "POST", headers: { authorization: `Bearer ${session.token}`, "content-type": "application/json", "x-kelvara-network": "devnet", "x-kelvara-genesis": NETWORK_GENESIS.devnet }, body: JSON.stringify({ network: "devnet", wallet, shares: "1" }) });
    assert.equal(response.status, 400);
    assert.deepEqual(await json(response), { error: "internal_error" });
    assert.equal(ctx.rpc.calls.filter(call => call.method !== "getGenesisHash").length, 0);
  } finally { await closeAll(ctx); }
});

test("Devnet owner binding rejects wallet mismatch before private or downstream calls", async () => {
  const ctx = await setup({ withOperations: true });
  try {
    const session = await authenticate(ctx.base);
    const headers = { authorization: `Bearer ${session.token}`, "x-kelvara-network": "devnet", "x-kelvara-genesis": NETWORK_GENESIS.devnet };
    for (const path of [`/api/portfolio/${otherWallet}`, `/api/inspect/${otherWallet}`]) {
      const response = await fetch(`${ctx.base}${path}`, { headers });
      assert.equal(response.status, 401);
      assert.deepEqual(await json(response), { error: "internal_error" });
    }
    assert.equal(ctx.server.calls.inspect, 0);
    assert.equal(ctx.server.calls.operations, 0);
    assert.equal(ctx.server.calls.store, 0);
    assert.equal(ctx.rpc.calls.filter(call => call.method !== "getGenesisHash").length, 0);
  } finally { await closeAll(ctx); }
});

test("Devnet evacuation status rejects before Mainnet RPC", async () => {
  const ctx = await setup();
  try {
    const session = await authenticate(ctx.base);
    const response = await fetch(`${ctx.base}/api/evacuation/status/${"1".repeat(64)}`, { headers: { authorization: `Bearer ${session.token}`, "x-kelvara-network": "devnet", "x-kelvara-genesis": NETWORK_GENESIS.devnet } });
    assert.equal(response.status, 400);
    assert.deepEqual(await json(response), { error: "internal_error" });
    assert.equal(ctx.rpc.calls.filter(call => call.method !== "getGenesisHash").length, 0);
  } finally { await closeAll(ctx); }
});

test("every protected action and status route rejects Devnet before side effects", async () => {
  const ctx = await setup({ withOperations: true });
  try {
    const session = await authenticate(ctx.base);
    const headers = { authorization: `Bearer ${session.token}`, "content-type": "application/json", "x-kelvara-network": "devnet", "x-kelvara-genesis": NETWORK_GENESIS.devnet };
    const routes = [
      ["GET", "/api/protection/status"],
      ["POST", "/api/protection/nonce-setup/prepare"], ["POST", "/api/protection/nonce-setup/submit"],
      ["POST", "/api/protection/prepare"], ["POST", "/api/protection/arm"], ["POST", "/api/protection/fast-close"],
      ["POST", "/api/protection/revoke/prepare"], ["POST", "/api/protection/revoke"], ["POST", "/api/protection/revoke/finalize"],
      ["POST", "/api/protection/manual-evacuation/finalize"], ["POST", "/api/evacuation/prepare"], ["POST", "/api/evacuation/submit"],
    ];
    for (const [method, path] of routes) {
      const response = await fetch(`${ctx.base}${path}`, { method, headers, body: method === "POST" ? JSON.stringify({ network: "devnet", wallet, nonceAccounts: [], variants: [], signedTransaction: "x", signature: "x" }) : undefined });
      assert.equal(response.status, 400, `${method} ${path}`);
      assert.deepEqual(await json(response), { error: "internal_error" }, `${method} ${path}`);
    }
    assert.deepEqual(ctx.server.calls, { inspect: 0, store: 0, operations: 0, prepare: 0, finalize: 0 });
    assert.equal(ctx.rpc.calls.filter(call => call.method !== "getGenesisHash").length, 0);
  } finally { await closeAll(ctx); }
});

test("Devnet portfolio and inspect auth matrix fails closed before forbidden calls", async () => {
  const ctx = await setup();
  try {
    const session = await authenticate(ctx.base);
    const baseline = { inspect: ctx.server.calls.inspect, rpc: ctx.rpc.calls.filter(call => call.method !== "getGenesisHash").length };
    const cases = [
      ["missing token", {}],
      ["malformed token", { authorization: "Bearer definitely-not-a-session" }],
      ["wrong genesis", { authorization: `Bearer ${session.token}`, "x-kelvara-genesis": NETWORK_GENESIS["mainnet-beta"] }],
      ["wrong network", { authorization: `Bearer ${session.token}`, "x-kelvara-network": "mainnet-beta" }, true],
    ];
    for (const [label, extra, mainnetBehavior] of cases) {
      const headers = { "x-kelvara-network": "devnet", "x-kelvara-genesis": NETWORK_GENESIS.devnet, ...extra };
      for (const route of [`/api/portfolio/${wallet}`, `/api/inspect/${wallet}`]) {
        const before = { inspect: ctx.server.calls.inspect, rpc: ctx.rpc.calls.filter(call => call.method !== "getGenesisHash").length };
        const response = await fetch(`${ctx.base}${route}`, { headers });
        assert.notEqual(response.status, 200, `${label} ${route}`);
        await json(response);
        if (!mainnetBehavior) {
          assert.equal(ctx.server.calls.inspect, before.inspect, `${label} ${route} inspector side effect`);
          assert.equal(ctx.rpc.calls.filter(call => call.method !== "getGenesisHash").length, before.rpc, `${label} ${route} RPC side effect`);
        }
      }
    }
    for (const route of ["/api/portfolio/not-a-solana-address", "/api/inspect/not-a-solana-address"]) {
      const before = { inspect: ctx.server.calls.inspect, rpc: ctx.rpc.calls.filter(call => call.method !== "getGenesisHash").length };
      const response = await fetch(`${ctx.base}${route}`, { headers: { authorization: `Bearer ${session.token}`, "x-kelvara-network": "devnet", "x-kelvara-genesis": NETWORK_GENESIS.devnet } });
      assert.equal(response.status, 400, route);
      await json(response);
      assert.equal(ctx.server.calls.inspect, before.inspect, `${route} inspector side effect`);
      assert.equal(ctx.rpc.calls.filter(call => call.method !== "getGenesisHash").length, before.rpc, `${route} RPC side effect`);
    }
  } finally { await closeAll(ctx); }
});

test("Devnet genesis mismatch, missing binding, and unavailable RPC fail closed", async () => {
  const bad = await fakeRpcServer({ response: "wrong" });
  const verifier = createGenesisVerifier({ network: "devnet", rpcUrl: bad.url, timeoutMs: 30 });
  await assert.rejects(verifier.verify(), /genesis_hash_mismatch/);
  await new Promise(resolve => bad.server.close(resolve));
  const timeoutRpc = await fakeRpcServer({ delay: 100 });
  await assert.rejects(createGenesisVerifier({ network: "devnet", rpcUrl: timeoutRpc.url, timeoutMs: 10 }).verify(), /timeout/);
  await new Promise(resolve => timeoutRpc.server.close(resolve));
});
