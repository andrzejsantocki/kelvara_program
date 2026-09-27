import test from "node:test";
import assert from "node:assert/strict";
import { runDemo } from "../src/apps/demo-cli/run.js";

const WALLET = "11111111111111111111111111111111";

function sink() {
  const lines = [];
  return { lines, write: value => lines.push(String(value)) };
}

test("demo connects a public wallet and shows real pipeline progress", async () => {
  const output = sink();
  const discover = async wallet => ({
    wallet,
    sourceStatus: "verified",
    sources: [{ name: "rpc-a", status: "ok" }, { name: "rpc-b", status: "ok" }],
    positions: [{ asset: "ONYC", amount: "12.5", mint: "mint", tokenAccounts: [{ address: "token-account", program: "spl", rawAmount: "12500000" }] }],
  });
  const assure = async () => ({
    sourceStatus: "verified",
    program: { upgradeAuthority: "upgrade-key", deploymentSlot: 42 },
    token: { mintAuthority: "mint-key", freezeAuthority: "freeze-key", supply: "1000" },
    conclusion: "No monitored control condition is currently breached.",
    monitors: [
      { id: "program-control", status: "active", reason: "verified" },
      { id: "protocol-nav", status: "unavailable", reason: "not attached" },
    ],
  });

  const code = await runDemo({ wallet: WALLET, write: output.write, discover, assure });

  assert.equal(code, 0);
  const text = output.lines.join("\n");
  assert.match(text, /CONNECTED \(read-only\)/);
  assert.match(text, /ONYC position.*12\.5/);
  assert.match(text, /RPC agreement.*verified/);
  assert.match(text, /program-control.*ACTIVE/);
  assert.match(text, /protocol-nav.*UNAVAILABLE/);
  assert.match(text, /No transaction was built, signed, or sent/);
});

test("demo rejects an invalid wallet before network work", async () => {
  const output = sink();
  let called = false;
  const code = await runDemo({
    wallet: "bad-wallet",
    write: output.write,
    discover: async () => { called = true; },
    assure: async () => ({}),
  });
  assert.equal(code, 2);
  assert.equal(called, false);
  assert.match(output.lines.join("\n"), /Invalid Solana wallet address/);
});

test("demo shows a valid wallet with no supported ONYC position", async () => {
  const output = sink();
  const code = await runDemo({
    wallet: WALLET,
    write: output.write,
    discover: async wallet => ({ wallet, sourceStatus: "verified", sources: [], positions: [] }),
    assure: async () => { throw new Error("must_not_run"); },
  });
  assert.equal(code, 0);
  assert.match(output.lines.join("\n"), /No ONYC position found/);
});
