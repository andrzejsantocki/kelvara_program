import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOperationsDatabase } from "/home/andy/hermes-run/kelvara-governance-mvp-app/packages/observation-hub/src/database.js";
import { createBackendServer } from "/home/andy/hermes-run/kelvara-governance-mvp-app/packages/observation-hub/src/server.js";
import { recordGovernanceAction } from "/home/andy/hermes-run/kelvara-governance-mvp-app/packages/observation-hub/src/governance-actions.js";
import { createKaminoMonitorServer } from "../subapps/kamino-monitor/server.js";
import { createGovernanceClient } from "../subapps/kamino-monitor/governance.js";

const WALLET = "4JM5vsoGPkMMZCZusMC6rTNZpm4pFweBPQf36vT8yZ8x";
const OTHER = "5NfR5kVYqXzR8VY7H5YdN7J6uW2vQ9eN3KpL4mT6sR8";
const PROGRAM = "SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf";
const MULTISIG = "7qipzLR9j1CvdxE1XJEFgvoyFmgBpgw5hMdHBMPcJtM";
const HUB_TOKEN = "governance-e2e-hub-token-012345678901234567890";
const GOVERNANCE_QUERY_TOKEN = "governance-e2e-query-token-012345678901234567890";
const SESSION = `session-${WALLET}`;
const HUB_OPTIONS = {
  governanceQueryToken: GOVERNANCE_QUERY_TOKEN,
  evacuationToken: "e".repeat(40), evaluationToken: "v".repeat(40), assignmentToken: "a".repeat(40),
};

function action(index, status = "active") {
  return {
    schemaVersion: "governance-action/v1", chain: "solana", network: "mainnet-beta", provider: "squads", generation: "v4",
    programId: PROGRAM, multisigAddress: MULTISIG, vaultIndex: 1, vaultAddress: MULTISIG, transactionIndex: index,
    actionAddress: `7qipzLR9j1CvdxE1XJEFgvoyFmgBpgw5hMdHBMPcJtM`, status, proposer: null,
    createdSlot: index, createdAt: "2020-10-09T10:00:00.000Z", finalizedSlot: index,
    finalizedAt: "2020-10-09T10:00:01.000Z", threshold: 2, eligibleMemberCount: 2,
    members: [
      { address: WALLET, permissions: { initiate: true, vote: true, execute: false }, providerData: { type: "squads-v4-member", permissionMask: 3 } },
      { address: OTHER, permissions: { initiate: false, vote: true, execute: true }, providerData: { type: "squads-v4-member", permissionMask: 6 } },
    ],
    approvals: [], rejections: [], executionEligibility: { state: "ineligible", reason: "threshold not met", version: "squads-v4@1" },
    instructions: [{ index: 0, innerInstructionIndex: 0, programId: PROGRAM, accounts: [WALLET], rawData: [9, 8, 7], intent: { kind: "unknown" }, decoder: { family: "squads-v4", version: "2.1.4", artifactHash: `sha256:${"a".repeat(64)}` }, unresolved: false, provenance: { transactionAddress: MULTISIG, accountAddress: MULTISIG, staticAccountIndexes: [0] } }],
    unresolvedInstructionCount: 0, evidenceRef: `sha256:${"b".repeat(64)}`, sourceSignatures: [], decoderFamily: "squads-v4", decoderVersion: "2.1.4", artifactHash: `sha256:${"a".repeat(64)}`,
    observedSlot: index, observedAt: "2020-10-09T10:00:01.000Z", canonicalPayloadHash: null, idempotencyKey: `governance-e2e-${index}`,
  };
}

async function listen(server) { server.listen(0, "127.0.0.1"); await once(server, "listening"); return `http://127.0.0.1:${server.address().port}`; }
async function close(server) { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }

async function startHub(path) {
  const db = createOperationsDatabase(path);
  for (let i = 1; i <= 12; i++) recordGovernanceAction(db, action(i, i === 1 ? "active" : "executed"));
  const server = createBackendServer({ db, tokens: new Map([["squads-mainnet", HUB_TOKEN]]), ...HUB_OPTIONS });
  return { db, server, url: await listen(server) };
}

function startProgram(hubUrl) {
  const walletAuth = { authorize(value) { if (value === SESSION) return WALLET; throw new Error("authentication_required"); } };
  return createKaminoMonitorServer({ inspector: { inspect: async () => ({}) }, walletAuth, governanceQuery: createGovernanceClient({ url: hubUrl, token: GOVERNANCE_QUERY_TOKEN }), governanceCursorSecret: "s".repeat(32) });
}

async function get(base, token = SESSION, query = "network=mainnet-beta") {
  return fetch(`${base}/api/governance?${query}`, { headers: { authorization: `Bearer ${token}` } });
}

test("cross-service Governance E2E uses real Hub HTTP, signed cursor, auth scope, and restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "governance-cross-service-"));
  const dbPath = join(dir, "hub.sqlite");
  let hub, program;
  try {
    hub = await startHub(dbPath);
    program = startProgram(hub.url);
    const programUrl = await listen(program);
    const first = await get(programUrl, SESSION, "network=mainnet-beta&history_limit=10");
    assert.equal(first.status, 200);
    const body = await first.json();
    assert.deepEqual(body.wallets.map(wallet => wallet.address), [WALLET]);
    const vault = body.wallets[0].vaults[0];
    assert.equal(vault.requiresAttention.length, 1);
    assert.equal(vault.requiresAttention[0].sourceSignature, null);
    assert.deepEqual(vault.requiresAttention[0].instructions[0].rawData, [9, 8, 7]);
    assert.equal(vault.requiresAttention[0].instructions[0].provenance.accountAddress, MULTISIG);
    assert.equal(JSON.stringify(body).includes("rawBytes"), false);
    assert.equal(JSON.stringify(body).includes("sourceSignatures"), false);
    const cursor = vault.nextHistoryCursor;
    assert.equal(typeof cursor, "string");
    const second = await get(programUrl, SESSION, `network=mainnet-beta&history_limit=10&cursor=${encodeURIComponent(cursor)}`);
    assert.equal(second.status, 200);
    assert.equal((await second.json()).wallets[0].vaults[0].recentChanges.length, 1);
    assert.equal((await get(programUrl, `session-${OTHER}`)).status, 401);
    assert.equal((await get(programUrl, SESSION, `network=mainnet-beta&cursor=${encodeURIComponent(cursor)}x`)).status, 400);
    assert.equal((await get(programUrl, SESSION, "network=devnet")).status, 400);

    await close(program); await close(hub.server); hub.db.close();
    hub = await startHub(dbPath);
    program = startProgram(hub.url);
    const reopenedUrl = await listen(program);
    const reopened = await get(reopenedUrl);
    assert.equal(reopened.status, 200);
    assert.equal((await reopened.json()).wallets[0].vaults[0].requiresAttention.length, 1);
  } finally {
    if (program?.listening) await close(program).catch(() => {});
    if (hub?.server?.listening) await close(hub.server).catch(() => {});
    try { hub?.db?.close(); } catch {}
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cross-service upstream auth mismatch is unavailable, never an empty success", async () => {
  const dir = mkdtempSync(join(tmpdir(), "governance-cross-service-auth-"));
  const dbPath = join(dir, "hub.sqlite");
  let hub, program;
  try {
    hub = await startHub(dbPath);
    program = createKaminoMonitorServer({ inspector: { inspect: async () => ({}) }, walletAuth: { authorize: () => WALLET }, governanceQuery: createGovernanceClient({ url: hub.url, token: "wrong-hub-token-012345678901234567890123" }), governanceCursorSecret: "s".repeat(32) });
    const url = await listen(program);
    const response = await get(url);
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: "governance_unavailable" });
  } finally {
    if (program?.listening) await close(program).catch(() => {});
    if (hub?.server?.listening) await close(hub.server).catch(() => {});
    try { hub?.db?.close(); } catch {}
    rmSync(dir, { recursive: true, force: true });
  }
});
