import test from "node:test";
import assert from "node:assert/strict";
import { networkProfile, redactRpcUrl } from "./network-profile.js";

test("selects devnet with safe public default", () => {
  assert.deepEqual(networkProfile({ KELVARA_NETWORK: "devnet" }), {
    cluster: "devnet",
    rpcUrls: ["https://api.devnet.solana.com"],
    source: "default",
  });
});

test("selects mainnet-beta with safe public default", () => {
  assert.equal(networkProfile({ KELVARA_NETWORK: "mainnet-beta" }).rpcUrls[0], "https://api.mainnet-beta.solana.com");
});

test("uses cluster-specific RPC list without leaking credentials", () => {
  const profile = networkProfile({
    KELVARA_NETWORK: "devnet",
    KELVARA_DEVNET_RPC_URLS: "https://rpc.example/a?api-key=secret,https://rpc2.example/path",
  });
  assert.equal(profile.rpcUrls.length, 2);
  assert.equal(profile.source, "environment");
  assert.equal(redactRpcUrl(profile.rpcUrls[0]), "https://rpc.example/[redacted]");
});

test("rejects unsupported network and mainnet RPC in devnet variable", () => {
  assert.throws(() => networkProfile({ KELVARA_NETWORK: "testnet" }), /unsupported_network/);
  assert.throws(() => networkProfile({
    KELVARA_NETWORK: "devnet",
    KELVARA_DEVNET_RPC_URLS: "https://api.mainnet-beta.solana.com",
  }), /cluster_rpc_mismatch/);
});
