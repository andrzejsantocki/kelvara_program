import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { spawn, spawnSync } from "node:child_process";
import { createWalletInspectorApp } from "../subapps/wallet-inspector/backend/app.js";
import { createWalletInspectorRuntime } from "../subapps/wallet-inspector/backend/runtime.js";
import { createFixtureLabServer } from "../subapps/protocol-fixture-lab/server.js";
import { FIXTURE_HOLDER } from "../subapps/protocol-fixture-lab/state.js";

const WALLET = "11111111111111111111111111111111";

async function withApp(dependencies, run) {
  const app = createWalletInspectorApp(dependencies);
  app.listen(0, "127.0.0.1");
  await once(app, "listening");
  try {
    await run(`http://127.0.0.1:${app.address().port}`);
  } finally {
    app.close();
    await once(app, "close");
  }
}

test("wallet inspector serves its standalone interface", async () => {
  await withApp({}, async baseUrl => {
    const response = await fetch(baseUrl);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /text\/html/);
    const html = await response.text();
    assert.match(html, /Monitor a position/);
    assert.match(html, /Wallet or token account/);
    assert.match(html, /Mainnet/);
    assert.match(html, /Devnet/);
    assert.match(html, /Devnet-fixture/);
    assert.match(html, /Connect fixture wallet/);
    assert.match(html, /Backend services/);
    assert.match(html, /Alerts/);
  });
});

test("wallet inspector exposes isolated health", async () => {
  await withApp({}, async baseUrl => {
    const response = await fetch(`${baseUrl}/api/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      service: "kelvara-wallet-inspector",
      mode: "read-only",
    });
  });
});

test("wallet inspection returns discovery and assurance in one request", async () => {
  await withApp({
    discoverWallet: async wallet => ({ wallet, sourceStatus: "verified", positions: [{ asset: "ONYC", amount: "10" }] }),
    getAssurance: async wallet => ({ wallet, assurance: { sourceStatus: "verified", conclusion: "No monitored control condition is currently breached." } }),
  }, async baseUrl => {
    const response = await fetch(`${baseUrl}/api/inspect/${WALLET}`);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.wallet, WALLET);
    assert.equal(result.discovery.positions[0].asset, "ONYC");
    assert.match(result.assurance.assurance.conclusion, /No monitored control/);
  });
});

test("wallet inspection selects mainnet or devnet explicitly", async () => {
  const clusters = [];
  await withApp({
    discoverAddress: async (address, cluster) => {
      clusters.push(cluster);
      return { wallet: address, cluster, sourceStatus: "single_source", positions: [] };
    },
  }, async baseUrl => {
    const response = await fetch(`${baseUrl}/api/inspect/${WALLET}?cluster=devnet`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).cluster, "devnet");
    assert.deepEqual(clusters, ["devnet"]);
  });
});

test("monitored mint inspection requests assurance without inventing a holder", async () => {
  const mint = "5Y8NV33Vv7WbnLfq3zBcKSdYPrk7g2KoiQoe7M2tcxp5";
  let assuranceCalled = false;
  await withApp({
    discoverAddress: async () => ({
      inputType: "monitored_mint",
      inputAddress: mint,
      wallet: null,
      positions: [],
      monitoredAsset: { asset: "ONYC", mint },
    }),
    getAssurance: async (_wallet, _cluster, discovery) => {
      assuranceCalled = discovery.inputType === "monitored_mint";
      return { assurance: { sourceStatus: "single_source" } };
    },
  }, async baseUrl => {
    const response = await fetch(`${baseUrl}/api/inspect/${mint}?cluster=mainnet`);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.wallet, null);
    assert.equal(result.discovery.monitoredAsset.asset, "ONYC");
    assert.equal(assuranceCalled, true);
  });
});

test("wallet inspector fixture network discovers the deterministic ONYC holder", async () => {
  const fixture = createFixtureLabServer();
  fixture.listen(0, "127.0.0.1");
  await once(fixture, "listening");
  try {
    const fixtureUrl = `http://127.0.0.1:${fixture.address().port}/rpc`;
    const runtime = createWalletInspectorRuntime({ FIXTURE_RPC_URL: fixtureUrl });
    const result = await runtime.inspect(FIXTURE_HOLDER, "devnet-fixture");
    assert.equal(result.network, "devnet-fixture");
    assert.equal(result.cluster, "devnet");
    assert.equal(result.mode, "fixture_simulation");
    assert.equal(result.discovery.positions[0].amount, "1000000");
    assert.equal(result.assurance.assurance.program.programId, "onreuGhHHgVzMWSkj2oQDLDtvvGvoepBPkqyaubFcwe");
  } finally {
    fixture.close(); await once(fixture, "close");
  }
});

test("operator view proxies reliable backend health and fixture alerts", async () => {
  const calls = [];
  const fetchImpl = async url => {
    calls.push(url);
    if (url.endsWith("/api/health")) return { ok: true, json: async () => ({ ok: true, service: "dependency" }) };
    return { ok: true, json: async () => ([{ id: "alert-1", mode: "fixture_simulation", lifecycle: "open", severity: "high", ruleId: "fixture-paused" }]) };
  };
  await withApp({
    discoverAddress: async address => ({ wallet: address, positions: [] }),
    serviceUrls: { fixtureLab: "http://fixture", alertConsole: "http://alerts" },
    fetchImpl,
  }, async baseUrl => {
    let response = await fetch(`${baseUrl}/api/services`);
    const services = await response.json();
    assert.equal(services.walletInspector.status, "healthy");
    assert.equal(services.fixtureLab.status, "healthy");
    assert.equal(services.alertConsole.status, "healthy");
    response = await fetch(`${baseUrl}/api/alerts`);
    assert.equal((await response.json())[0].mode, "fixture_simulation");
    assert.deepEqual(calls, ["http://fixture/api/health", "http://alerts/api/health", "http://alerts/api/alerts?mode=fixture_simulation"]);
  });
});

test("wallet inspection rejects unknown clusters", async () => {
  await withApp({ discoverAddress: async () => ({ positions: [] }) }, async baseUrl => {
    const response = await fetch(`${baseUrl}/api/inspect/${WALLET}?cluster=testnet`);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "invalid_cluster" });
  });
});

test("position remains visible when assurance is unavailable", async () => {
  await withApp({
    discoverAddress: async address => ({ wallet: address, positions: [{ asset: "ONYC", amount: "10" }] }),
    getAssurance: async () => { throw new Error("all_rpc_sources_failed"); },
  }, async baseUrl => {
    const response = await fetch(`${baseUrl}/api/inspect/${WALLET}`);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.discovery.positions[0].asset, "ONYC");
    assert.equal(result.assurance, null);
    assert.equal(result.assuranceError, "all_rpc_sources_failed");
  });
});

test("wallet without ONYC is a successful empty inspection", async () => {
  let assuranceCalled = false;
  await withApp({
    discoverWallet: async wallet => ({ wallet, sourceStatus: "verified", positions: [] }),
    getAssurance: async () => { assuranceCalled = true; },
  }, async baseUrl => {
    const response = await fetch(`${baseUrl}/api/inspect/${WALLET}`);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.deepEqual(result.discovery.positions, []);
    assert.equal(result.assurance, null);
    assert.equal(assuranceCalled, false);
  });
});

test("wallet inspection maps known failures without leaking internals", async () => {
  await withApp({
    discoverWallet: async () => { throw new Error("invalid_wallet"); },
  }, async baseUrl => {
    const response = await fetch(`${baseUrl}/api/inspect/not-a-wallet`);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "invalid_wallet" });
  });
});

test("start script replaces only the previous wallet inspector process", { timeout: 10_000 }, async () => {
  const root = new URL("../", import.meta.url);
  const port = 20_000 + (process.pid % 10_000);
  const first = spawn("node", ["subapps/wallet-inspector/backend/server.js"], {
    cwd: root,
    env: { ...process.env, WALLET_INSPECTOR_PORT: String(port) },
    stdio: "ignore",
  });
  try {
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.equal(first.exitCode, null);
    const launched = spawnSync("sh", ["subapps/wallet-inspector/start.sh"], {
      cwd: root,
      env: { ...process.env, WALLET_INSPECTOR_PORT: String(port) },
      encoding: "utf8",
      timeout: 5_000,
    });
    assert.equal(launched.status, 0, launched.stderr);
    assert.match(launched.stdout, /Wallet Inspector started/);
    await once(first, "exit");
    const response = await fetch(`http://127.0.0.1:${port}/api/health`);
    assert.equal(response.status, 200);
  } finally {
    spawnSync("pkill", ["-f", `node subapps/wallet-inspector/backend/server.js`]);
  }
});
