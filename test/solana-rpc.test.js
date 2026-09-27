import test from "node:test";
import assert from "node:assert/strict";
import { createSolanaRpc } from "../src/platform/solana/rpc.js";

const WALLET = "11111111111111111111111111111111";
const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

test("RPC adapter converts jsonParsed token accounts without losing raw amount", async () => {
  const calls = [];
  const rpc = createSolanaRpc("https://rpc.invalid", {
    name: "fixture",
    fetchImpl: async (_url, init) => {
      calls.push(JSON.parse(init.body));
      return { ok: true, json: async () => ({ jsonrpc: "2.0", id: 1, result: { context: { slot: 9 }, value: [{ pubkey: "acct", account: { owner: TOKEN, data: { parsed: { info: { mint: WALLET, owner: WALLET, tokenAmount: { amount: "123", decimals: 2 } } } } } }] } }) };
    },
  });
  const rows = await rpc.getTokenAccounts(WALLET, TOKEN);
  assert.equal(calls[0].method, "getTokenAccountsByOwner");
  assert.deepEqual(rows, [{ pubkey: "acct", program: TOKEN, slot: 9, parsed: { mint: WALLET, owner: WALLET, amount: "123", decimals: 2 } }]);
});

test("RPC JSON error becomes provider error without leaking URL", async () => {
  const rpc = createSolanaRpc("https://secret.invalid/?api-key=secret", {
    name: "fixture",
    fetchImpl: async () => ({ ok: true, json: async () => ({ error: { code: 429, message: "rate limit" } }) }),
  });
  await assert.rejects(() => rpc.getTokenAccounts(WALLET, TOKEN), error => {
    assert.match(error.message, /fixture.*rate limit/);
    assert.doesNotMatch(error.message, /secret/);
    return true;
  });
});
