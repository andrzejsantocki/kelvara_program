import test from "node:test";
import assert from "node:assert/strict";
import { parseWalletInspectorArgs, formatInspection } from "../subapps/wallet-inspector/cli.js";

const MINT = "5Y8NV33Vv7WbnLfq3zBcKSdYPrk7g2KoiQoe7M2tcxp5";

test("CLI requires an explicit mainnet or devnet cluster", () => {
  assert.throws(() => parseWalletInspectorArgs([MINT]), /missing_cluster/);
  assert.throws(() => parseWalletInspectorArgs([MINT, "--cluster", "testnet"]), /invalid_cluster/);
  assert.deepEqual(parseWalletInspectorArgs([MINT, "--cluster", "devnet"]), {
    address: MINT,
    cluster: "devnet",
    json: false,
  });
});

test("CLI accepts JSON output before or after cluster", () => {
  assert.deepEqual(parseWalletInspectorArgs(["--json", "--cluster=mainnet", MINT]), {
    address: MINT,
    cluster: "mainnet",
    json: true,
  });
});

test("CLI formats a monitored mint without inventing holder balance", () => {
  const output = formatInspection({
    cluster: "mainnet",
    wallet: null,
    discovery: {
      inputType: "monitored_mint",
      monitoredAsset: { asset: "ONYC", mint: MINT },
      positions: [],
    },
    assurance: { assurance: { sourceStatus: "single_source" } },
  });
  assert.match(output, /Cluster: mainnet/);
  assert.match(output, /Monitored token: ONYC/);
  assert.match(output, new RegExp(MINT));
  assert.doesNotMatch(output, /Balance:/);
});

test("CLI formats resolved holder position", () => {
  const output = formatInspection({
    cluster: "mainnet",
    wallet: "owner",
    discovery: {
      inputType: "token_account",
      positions: [{ asset: "ONYC", mint: MINT, amount: "7747479.108350823" }],
    },
    assurance: null,
    assuranceError: "all_rpc_sources_failed",
  });
  assert.match(output, /Owner wallet: owner/);
  assert.match(output, /Balance: 7747479\.108350823 ONYC/);
  assert.match(output, /Assurance: unavailable/);
});
