import test from "node:test";
import assert from "node:assert/strict";
import { createSolanaRpc } from "../src/platform/solana/rpc.js";

test("RPC rejects oversized JSON before parsing", async () => {
  const rpc = createSolanaRpc("http://rpc.invalid", {
    fetchImpl: async () => ({ ok: true, body: (async function* () { yield Buffer.alloc(64 * 1024 + 1, 65); })() }),
  });
  await assert.rejects(rpc.getTokenAccounts("11111111111111111111111111111111", "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"), /body_too_large/);
});
