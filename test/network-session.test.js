import test from "node:test";
import assert from "node:assert/strict";
import { createGenesisVerifier, createNetworkBoundWalletAuth, NETWORK_GENESIS } from "../subapps/kamino-monitor/network-session.js";

import { Keypair } from "@solana/web3.js";
import nacl from "tweetnacl";
const keypair = Keypair.generate();
const WALLET = keypair.publicKey.toString();
const MAINNET = NETWORK_GENESIS["mainnet-beta"];
function rpcFetch(body, {status=200, malformed=false, delay=0}={}) {
 return async (_url, options) => {
  assert.equal(options.method, "POST");
  assert.deepEqual(JSON.parse(options.body), {jsonrpc:"2.0", id:1, method:"getGenesisHash", params:[]});
  if (delay) await new Promise(resolve => setTimeout(resolve, delay));
  return {ok: status >= 200 && status < 300, status, json: async () => malformed ? {} : {jsonrpc:"2.0", id:1, result:body}};
 };
}

test("verifies configured endpoint genesis with bounded JSON-RPC", async () => {
 const verifier=createGenesisVerifier({network:"mainnet-beta", rpcUrl:"http://rpc.test", fetchImpl:rpcFetch(MAINNET)});
 assert.deepEqual(await verifier.verify(), {network:"mainnet-beta", genesisHash:MAINNET, rpcUrl:"http://rpc.test"});
});

test("rejects wrong, malformed, HTTP-error, and timed-out genesis responses", async () => {
 for (const fetchImpl of [rpcFetch("wrong"),rpcFetch(MAINNET,{malformed:true}),rpcFetch(MAINNET,{status:503}),rpcFetch(MAINNET,{delay:50})]) {
  const verifier=createGenesisVerifier({network:"mainnet-beta",rpcUrl:"http://rpc.test",fetchImpl,timeoutMs:10});
  await assert.rejects(verifier.verify(), /genesis|rpc|timeout/i);
 }
});

test("challenge and session claims bind network and verified genesis", async () => {
 const verifier=createGenesisVerifier({network:"mainnet-beta",rpcUrl:"http://rpc.test",fetchImpl:rpcFetch(MAINNET)});
 const auth=createNetworkBoundWalletAuth({genesisVerifier:verifier, now:()=>1000});
 const challenge=await auth.issue(WALLET,"mainnet-beta");
 assert.equal(challenge.network,"mainnet-beta"); assert.equal(challenge.genesisHash,MAINNET);
 const signature=Buffer.from(nacl.sign.detached(Buffer.from(challenge.message),keypair.secretKey)).toString("base64");
 const token=await auth.verify(WALLET,challenge.message,signature,"mainnet-beta");
 assert.equal(token.network,"mainnet-beta"); assert.equal(token.genesisHash,MAINNET);
 assert.equal(await auth.authorize(token.token,{network:"mainnet-beta",genesisHash:MAINNET}),WALLET);
 await assert.rejects(auth.authorize(token.token,{network:"devnet",genesisHash:MAINNET}),/network/);
});

test("unsupported network and missing binding fail closed", async () => {
 assert.throws(() => createGenesisVerifier({network:"mainnet"}), /unsupported_network|configured/);
 const auth=createNetworkBoundWalletAuth({genesisVerifier:null});
 await assert.rejects(auth.authorize("missing",{network:"mainnet-beta",genesisHash:MAINNET}),/authentication/);
});
