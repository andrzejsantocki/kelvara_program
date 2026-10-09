import test from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import nacl from "tweetnacl";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { createWalletAuth } from "../subapps/kamino-monitor/protection.js";
import { createKaminoMonitorServer } from "../subapps/kamino-monitor/server.js";

const NETWORK = "mainnet-beta";
async function listen(server) { server.listen(0, "127.0.0.1"); await once(server, "listening"); return `http://127.0.0.1:${server.address().port}`; }
async function close(server) { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
async function verify(base, keypair, network = NETWORK, signatureOverride) {
  const challenge = await (await fetch(`${base}/api/auth/challenge`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ wallet: keypair.publicKey.toString(), network }) })).json();
  const signature = signatureOverride ?? Buffer.from(nacl.sign.detached(Buffer.from(challenge.message), keypair.secretKey)).toString("base64");
  return fetch(`${base}/api/auth/verify`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ wallet: keypair.publicKey.toString(), network, message: challenge.message, signature }) });
}
function fakeInspector() { return { inspect: async () => ({}) }; }

test("verified wallet auth delivers closed event before issuing session", async () => {
  const keypair = Keypair.generate(), events = [], auth = createWalletAuth({ linkWallet: async event => { events.push(event); return { accepted: true }; } });
  const server = createKaminoMonitorServer({ inspector: fakeInspector(), walletAuth: auth }); const base = await listen(server);
  try {
    const response = await verify(base, keypair); assert.equal(response.status, 200); const body = await response.json();
    assert.ok(body.token); assert.equal(events.length, 1);
    assert.deepEqual(Object.keys(events[0]).sort(), ["chain", "idempotencyKey", "network", "schemaVersion", "verification", "walletAddress"].sort());
    assert.equal(events[0].schemaVersion, "verified-wallet-link/v1"); assert.equal(events[0].chain, "solana"); assert.equal(events[0].network, NETWORK); assert.equal(events[0].walletAddress, keypair.publicKey.toString());
    assert.equal(events[0].verification.method, "solana-wallet-signature"); assert.equal(events[0].verification.challengeId.length, 64); assert.equal(events[0].verification.verifiedAt.length > 0, true);
    assert.doesNotMatch(JSON.stringify(events[0]), /Nonce:|signed|token|secret|challenge text/i);
  } finally { await close(server); }
});

test("invalid signature makes zero linkage calls", async () => {
  const keypair = Keypair.generate(), calls = []; const auth = createWalletAuth({ linkWallet: async event => calls.push(event) });
  const server = createKaminoMonitorServer({ inspector: fakeInspector(), walletAuth: auth }); const base = await listen(server);
  try { const response = await verify(base, keypair, NETWORK, Buffer.alloc(64, 7).toString("base64")); assert.equal(response.status, 401); assert.equal(calls.length, 0); } finally { await close(server); }
});

test("linkage failure issues no session", async () => {
  for (const failure of [new Error("control_plane_unavailable"), { accepted: false }, { accepted: true, extra: true }]) {
    const keypair = Keypair.generate(), auth = createWalletAuth({ linkWallet: async () => { if (failure instanceof Error) throw failure; return failure; } });
    const server = createKaminoMonitorServer({ inspector: fakeInspector(), walletAuth: auth }); const base = await listen(server);
    try { const response = await verify(base, keypair); assert.equal(response.status, 401); const body = await response.json(); assert.equal(body.error, "wallet_link_unavailable"); } finally { await close(server); }
  }
});

test("same idempotency key replays, altered event conflicts", async () => {
  const keypair = Keypair.generate(), auth = createWalletAuth(); const event = { schemaVersion: "verified-wallet-link/v1", chain: "solana", network: NETWORK, walletAddress: keypair.publicKey.toString(), verification: { method: "solana-wallet-signature", verifiedAt: "2026-10-09T00:00:00.000Z", challengeId: "a".repeat(64) }, idempotencyKey: createHash("sha256").update("event").digest("hex") };
  const first = auth.acceptLink(event); assert.deepEqual(auth.acceptLink(event), { accepted: true, idempotent: true }); assert.throws(() => auth.acceptLink({ ...event, network: "devnet" }), /idempotency_conflict/);
});
