import test from "node:test";
import assert from "node:assert/strict";
import { createSolanaRpc } from "../src/platform/solana/rpc.js";

const ADDRESS = "11111111111111111111111111111111";

test("getAccount preserves raw bytes and account metadata", async () => {
  const rpc = createSolanaRpc("https://rpc.invalid", {
    name: "fixture",
    fetchImpl: async () => ({ ok: true, json: async () => ({ result: { context: { slot: 77 }, value: { owner: ADDRESS, executable: true, lamports: 42, data: [Buffer.from([2, 3, 4]).toString("base64"), "base64"] } } }) }),
  });
  const account = await rpc.getAccount(ADDRESS);
  assert.equal(account.slot, 77);
  assert.equal(account.owner, ADDRESS);
  assert.equal(account.executable, true);
  assert.equal(account.lamports, 42);
  assert.deepEqual([...account.data], [2, 3, 4]);
});

test("missing account is explicit", async () => {
  const rpc = createSolanaRpc("https://rpc.invalid", {
    name: "fixture",
    fetchImpl: async () => ({ ok: true, json: async () => ({ result: { context: { slot: 77 }, value: null } }) }),
  });
  await assert.rejects(() => rpc.getAccount(ADDRESS), /account_not_found/);
});
