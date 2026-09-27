import test from "node:test";
import assert from "node:assert/strict";
import { validateSolanaAddress, discoverAddress, discoverWallet } from "../src/domains/discovery/wallet.js";

const WALLET = "11111111111111111111111111111111";
const ONYC = "5Y8NV33Vv7WbnLfq3zBcKSdYPrk7g2KoiQoe7M2tcxp5";
const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

function account({ pubkey, mint = ONYC, owner = WALLET, amount, decimals = 6, program = TOKEN }) {
  return { pubkey, program, parsed: { mint, owner, amount, decimals } };
}

test("validates decoded 32-byte Solana addresses", () => {
  assert.equal(validateSolanaAddress(WALLET), true);
  assert.equal(validateSolanaAddress(ONYC), true);
  assert.equal(validateSolanaAddress("not-a-wallet"), false);
  assert.equal(validateSolanaAddress(`${WALLET}1`), false);
});

test("aggregates ONYC across wallet-owned Token and Token-2022 accounts", async () => {
  const rpc = {
    name: "primary",
    getTokenAccounts: async (_wallet, program) => program === TOKEN
      ? [account({ pubkey: "a", amount: "1200000" }), account({ pubkey: "foreign", amount: "999", owner: ONYC })]
      : [account({ pubkey: "b", amount: "2300000", program: TOKEN_2022 })],
  };
  const result = await discoverWallet(WALLET, { rpcs: [rpc], tokenPrograms: [TOKEN, TOKEN_2022] });
  assert.equal(result.positions.length, 1);
  assert.equal(result.positions[0].mint, ONYC);
  assert.equal(result.positions[0].rawAmount, "3500000");
  assert.equal(result.positions[0].amount, "3.5");
  assert.equal(result.positions[0].tokenAccounts.length, 2);
  assert.equal(result.positions[0].relationship.confidence, "verified-registry");
  assert.equal(result.sourceStatus, "single_source");
  assert.equal(result.positions[0].coverage, "degraded");
});

test("wallet without ONYC returns no supported position", async () => {
  const rpc = { name: "primary", getTokenAccounts: async () => [account({ pubkey: "x", mint: WALLET, amount: "10" })] };
  const result = await discoverWallet(WALLET, { rpcs: [rpc], tokenPrograms: [TOKEN] });
  assert.deepEqual(result.positions, []);
});

test("dual RPC disagreement is explicit and not silently accepted", async () => {
  const a = { name: "a", getTokenAccounts: async () => [account({ pubkey: "a", amount: "1000000" })] };
  const b = { name: "b", getTokenAccounts: async () => [account({ pubkey: "a", amount: "2000000" })] };
  const result = await discoverWallet(WALLET, { rpcs: [a, b], tokenPrograms: [TOKEN] });
  assert.equal(result.sourceStatus, "disagreement");
  assert.equal(result.positions[0].coverage, "degraded");
  assert.equal(result.positions[0].rawAmount, "1000000");
});

test("one failed RPC degrades but uses successful provider", async () => {
  const bad = { name: "bad", getTokenAccounts: async () => { throw new Error("429"); } };
  const good = { name: "good", getTokenAccounts: async () => [account({ pubkey: "a", amount: "1000000" })] };
  const result = await discoverWallet(WALLET, { rpcs: [bad, good], tokenPrograms: [TOKEN] });
  assert.equal(result.sourceStatus, "degraded");
  assert.equal(result.positions[0].rawAmount, "1000000");
  assert.deepEqual(result.sources.map(s => s.status), ["failed", "ok"]);
});

test("invalid wallet rejects before RPC work", async () => {
  let called = false;
  const rpc = { name: "rpc", getTokenAccounts: async () => { called = true; return []; } };
  await assert.rejects(() => discoverWallet("bad", { rpcs: [rpc], tokenPrograms: [TOKEN] }), /invalid_wallet/);
  assert.equal(called, false);
});

test("resolves an ONYC token-account address to its owner wallet", async () => {
  const tokenAccount = "9GEMGj45WgCHZ6d7em4K1drmwSjJU3v5CZQ8dLhFnHYM";
  const owner = "E3NiM5n6s5CKKWrrhaeVjVSTKscRrysCtZeXnxn6yMgp";
  const rpc = {
    name: "mainnet",
    getTokenAccount: async address => address === tokenAccount
      ? { pubkey: tokenAccount, program: TOKEN, parsed: { mint: ONYC, owner, amount: "7747479108350823", decimals: 9 } }
      : null,
    getTokenAccounts: async wallet => wallet === owner
      ? [account({ pubkey: tokenAccount, owner, amount: "7747479108350823", decimals: 9 })]
      : [],
  };
  const result = await discoverAddress(tokenAccount, { rpcs: [rpc], tokenPrograms: [TOKEN] });
  assert.equal(result.inputType, "token_account");
  assert.equal(result.inputAddress, tokenAccount);
  assert.equal(result.wallet, owner);
  assert.equal(result.positions[0].amount, "7747479.108350823");
});

test("recognizes the monitored ONYC mint without treating it as a holder", async () => {
  let ownerLookupCalled = false;
  const rpc = {
    name: "mainnet",
    getTokenAccount: async () => null,
    getTokenAccounts: async () => { ownerLookupCalled = true; return []; },
  };
  const result = await discoverAddress(ONYC, { rpcs: [rpc], tokenPrograms: [TOKEN] });
  assert.equal(result.inputType, "monitored_mint");
  assert.equal(result.inputAddress, ONYC);
  assert.equal(result.wallet, null);
  assert.deepEqual(result.positions, []);
  assert.equal(result.monitoredAsset.asset, "ONYC");
  assert.equal(result.monitoredAsset.mint, ONYC);
  assert.equal(ownerLookupCalled, false);
});
