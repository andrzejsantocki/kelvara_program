import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createFixtureLab } from "../subapps/protocol-fixture-lab/state.js";
import { createFixtureLabServer } from "../subapps/protocol-fixture-lab/server.js";
import { ONRE_PROGRAM_ID, ONYC_MINT, discoverAddress } from "../src/domains/discovery/wallet.js";
import { createSolanaRpc } from "../src/platform/solana/rpc.js";
import { createAlertConsole } from "../subapps/alert-console/server.js";
import { evaluateRule } from "../packages/rule-engine/index.js";

async function withServer(run) {
  const lab = createFixtureLab();
  const server = createFixtureLabServer({ lab });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try { await run(`http://127.0.0.1:${server.address().port}`, lab); }
  finally { server.close(); await once(server, "close"); }
}

async function rpc(base, method, params = []) {
  const response = await fetch(`${base}/rpc`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  assert.equal(response.status, 200);
  return (await response.json()).result;
}

test("reset creates a deterministic labeled baseline", () => {
  const first = createFixtureLab().snapshot();
  const second = createFixtureLab().snapshot();
  assert.deepEqual(first, second);
  assert.equal(first.mode, "fixture_simulation");
  assert.equal(first.cluster, "devnet");
  assert.equal(first.program.programId, ONRE_PROGRAM_ID);
  assert.equal(first.token.mint, ONYC_MINT);
  assert.equal(first.protocol.paused, false);
  assert.equal(first.protocol.redemptionHealthy, true);
});

test("upgrade-authority scenario mutates state and emits one deterministic transaction", () => {
  const lab = createFixtureLab();
  const before = lab.snapshot();
  const result = lab.trigger("upgrade-authority-transfer");
  const after = lab.snapshot();
  assert.notEqual(after.program.upgradeAuthority, before.program.upgradeAuthority);
  assert.equal(result.scenario, "upgrade-authority-transfer");
  assert.equal(after.slot, before.slot + 1);
  assert.equal(after.transactions.length, before.transactions.length + 1);
  assert.equal(after.transactions.at(-1).mode, "fixture_simulation");
});

test("unknown scenario cannot mutate fixture", () => {
  const lab = createFixtureLab();
  const before = lab.snapshot();
  assert.throws(() => lab.trigger("arbitrary-code"), /unknown_scenario/);
  assert.deepEqual(lab.snapshot(), before);
});

test("RPC facade supports the existing indexer methods", async () => {
  await withServer(async (base, lab) => {
    lab.trigger("upgrade-authority-transfer");
    assert.equal(await rpc(base, "getSlot", [{ commitment: "confirmed" }]), 1001);
    const signatures = await rpc(base, "getSignaturesForAddress", [ONRE_PROGRAM_ID, { limit: 1000 }]);
    assert.equal(signatures.length, 2);
    const transaction = await rpc(base, "getTransaction", [signatures[0].signature, { encoding: "jsonParsed" }]);
    assert.equal(transaction.slot, 1001);
    assert.equal(transaction.transaction.message.instructions[0].programId, ONRE_PROGRAM_ID);
    const accounts = await rpc(base, "getProgramAccounts", [ONRE_PROGRAM_ID, { encoding: "base64" }]);
    assert.ok(accounts.length >= 2);
    assert.match(accounts[0].account.data[0], /^[A-Za-z0-9+/]+=*$/);
  });
});

test("scenario evidence feeds the shared deterministic rule engine", () => {
  const lab = createFixtureLab();
  lab.trigger("pause");
  const evidence = lab.evidence();
  assert.equal(evidence.source.type, "fixture_rpc");
  assert.equal(evidence.value.paused, true);
  const result = evaluateRule({
    id: "pause", version: 1, name: "Protocol pause", field: "paused", operator: "equals",
    threshold: false, severity: "critical", recommendedAction: "Review protocol pause.",
  }, evidence);
  assert.equal(result.status, "breach");
});

test("control API lists, triggers, resets, and exports fixture state", async () => {
  await withServer(async base => {
    let response = await fetch(`${base}/api/scenarios`);
    const listed = await response.json();
    assert.ok(listed.scenarios.includes("vault-outflow"));
    response = await fetch(`${base}/api/scenarios/pause`, { method: "POST" });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).state.protocol.paused, true);
    response = await fetch(`${base}/api/reset`, { method: "POST" });
    assert.equal((await response.json()).state.protocol.paused, false);
    response = await fetch(`${base}/api/export`);
    assert.equal((await response.json()).label, "fixture-only-not-chain-data");
  });
});

test("activity API exposes RPC calls and scenario transactions", async () => {
  await withServer(async base => {
    await rpc(base, "getSlot");
    await fetch(`${base}/api/scenarios/pause`, { method: "POST" });
    const response = await fetch(`${base}/api/activity`);
    assert.equal(response.status, 200);
    const activity = await response.json();
    assert.equal(activity.rpcCalls.at(-1).method, "getSlot");
    assert.equal(activity.transactions.at(-1).scenario, "pause");
    assert.equal(activity.transactions.at(-1).slot, 1001);
  });
});

test("fixture holder is discoverable through the real Wallet Inspector RPC client", async () => {
  await withServer(async base => {
    const state = await (await fetch(`${base}/api/state`)).json();
    const holder = state.state.fixtureHolder.wallet;
    const rpcClient = createSolanaRpc(`${base}/rpc`, { name: "fixture" });
    const discovery = await discoverAddress(holder, {
      rpcs: [rpcClient],
      tokenPrograms: ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"],
    });
    assert.equal(discovery.wallet, holder);
    assert.equal(discovery.positions[0].mint, ONYC_MINT);
    assert.equal(discovery.positions[0].amount, "1000000");
  });
});

test("scenario can forward a fixture-simulation alert to Alert Console", async () => {
  const alerts = createAlertConsole({ database: ":memory:" });
  alerts.listen(0, "127.0.0.1");
  await once(alerts, "listening");
  const alertUrl = `http://127.0.0.1:${alerts.address().port}`;
  try {
    const labServer = createFixtureLabServer({ alertConsoleUrl: alertUrl });
    labServer.listen(0, "127.0.0.1");
    await once(labServer, "listening");
    const base = `http://127.0.0.1:${labServer.address().port}`;
    try {
      const scenario = await fetch(`${base}/api/scenarios/pause`, { method: "POST" });
      assert.equal(scenario.status, 200);
      const result = await scenario.json();
      assert.equal(result.rule.status, "breach");
      assert.equal(result.alert.created, true);
      const rows = await (await fetch(`${alertUrl}/api/alerts?mode=fixture_simulation`)).json();
      assert.equal(rows.length, 1);
      assert.match(rows[0].solanaMeaning, /paused field/);
      assert.equal(rows[0].subject.id, ONRE_PROGRAM_ID);
    } finally {
      labServer.close(); await once(labServer, "close");
    }
  } finally {
    alerts.close(); await once(alerts, "close");
  }
});

test("root launcher resolves the renamed integrated launcher", () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const launcher = readFileSync(`${root}start.sh`, "utf8");
  assert.match(launcher, /subapps\/protocol-fixture-lab\/start-integrated\.sh/);
  assert.equal(spawnSync("sh", ["-n", "start.sh"], { cwd: root }).status, 0);
});

test("start script waits for old process and starts the replacement", { timeout: 15_000 }, async () => {
  const root = new URL("../", import.meta.url);
  const port = 30_000 + (process.pid % 10_000);
  const env = { ...process.env, PROTOCOL_FIXTURE_LAB_PORT: String(port) };
  const first = spawn("node", ["subapps/protocol-fixture-lab/server.js"], { cwd: root, env, stdio: "ignore" });
  try {
    await new Promise(resolve => setTimeout(resolve, 250));
    assert.equal(first.exitCode, null);
    const firstExit = once(first, "exit");
    const launcher = spawn("sh", ["subapps/protocol-fixture-lab/start.sh"], { cwd: root, env, stdio: "ignore" });
    assert.equal((await once(launcher, "exit"))[0], 0);
    await firstExit;
    const rootPath = fileURLToPath(root);
    const pid = Number(readFileSync(`${rootPath}.runtime/protocol-fixture-lab/server.pid`, "utf8"));
    assert.ok(pid > 0);
    assert.equal(spawnSync("kill", ["-0", String(pid)]).status, 0);
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/health`)).status, 200);
    process.kill(pid, "SIGTERM");
  } finally {
    if (first.exitCode === null) first.kill("SIGTERM");
  }
});
