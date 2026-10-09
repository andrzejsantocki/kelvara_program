import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createKaminoMonitorServer } from "../subapps/kamino-monitor/server.js";

const WALLET = "11111111111111111111111111111111";
const token = `session-${WALLET}`;
const PROGRAM = "Vote111111111111111111111111111111111111111";
const canonical = {
  schemaVersion: "observation-hub-governance/v1",
  network: "mainnet-beta",
  freshness: { state: "fresh", observedAt: null, finalizedSlot: null },
  wallets: [{ address: WALLET, vaults: [{
    identity: { provider: "squads", generation: "v4", multisigAddress: WALLET, vaultIndex: 0, vaultAddress: WALLET },
    membership: { role: "member", permissions: ["vote"], threshold: 2, memberCount: 2 },
    requiresAttention: [{
      id: "action-attention", status: "active", decodedIntent: { summary: "Governance action", kind: "unknown" },
      approvalProgress: { approved: 1, rejected: 0, threshold: 2 }, userStatus: "approval_required",
      proposer: null, createdSlot: null, finalizedSlot: null, sourceSignature: null,
      instructions: [{ index: 0, programId: PROGRAM, accounts: [WALLET], rawData: [9, 8, 7], intent: { kind: "unknown" }, decoder: { family: "squads-v4", version: "2.1.4", artifactHash: "sha256:" + "a".repeat(64) }, unresolved: false, provenance: { transactionAddress: WALLET, accountAddress: WALLET, staticAccountIndexes: [0] } }],
      provenance: { decoderFamily: "squads-v4", decoderVersion: "2.1.4", artifactHash: "sha256:" + "a".repeat(64) }, unresolvedInstructionCount: 0
    }],
    currentActions: [], recentChanges: [], nextHistoryCursor: null
  }] }], warnings: []
};

test("accepts serialized canonical Hub action with nullable fields and raw instruction provenance", async () => {
  const walletAuth = { authorize(value) { if (value === token) return WALLET; throw new Error("authentication_required"); } };
  const app = createKaminoMonitorServer({ inspector: { inspect: async () => ({}) }, walletAuth, governanceQuery: async () => structuredClone(canonical), governanceCursorSecret: "s".repeat(32) });
  app.listen(0, "127.0.0.1"); await once(app, "listening");
  try {
    const response = await fetch(`http://127.0.0.1:${app.address().port}/api/governance?network=mainnet-beta`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(response.status, 200);
    const body = await response.json();
    const action = body.wallets[0].vaults[0].requiresAttention[0];
    assert.equal(action.sourceSignature, null);
    assert.equal(action.proposer, null);
    assert.deepEqual(action.instructions[0].rawData, [9, 8, 7]);
    assert.deepEqual(action.instructions[0].intent, { kind: "unknown" });
    assert.equal(action.instructions[0].provenance.accountAddress, WALLET);
  } finally { app.close(); await once(app, "close"); }
});
