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

test("RPC timeout covers a delayed response body and bounds malformed oversized bodies", async () => {
 const delayed = async () => ({ok:true,status:200,body:(async function*(){await new Promise(r=>setTimeout(r,40));yield Buffer.from('{"jsonrpc":"2.0","id":1,"result":"'+MAINNET+'"}');})()});
 await assert.rejects(createGenesisVerifier({network:"mainnet-beta",rpcUrl:"http://rpc.test",fetchImpl:delayed,timeoutMs:10}).verify(),/timeout/i);
 const oversized = async () => ({ok:true,status:200,body:(async function*(){yield Buffer.alloc(70_000, 65);})()});
 await assert.rejects(createGenesisVerifier({network:"mainnet-beta",rpcUrl:"http://rpc.test",fetchImpl:oversized}).verify(),/body_too_large|malformed/i);
});

test("challenge reservation is atomic and invalid signatures cannot replay", async () => {
 let verifies=0;
 const verifier={network:"mainnet-beta",verify:async()=>{verifies++;await new Promise(r=>setTimeout(r,5));return {network:"mainnet-beta",genesisHash:MAINNET}}};
 const auth=createNetworkBoundWalletAuth({genesisVerifier:verifier,now:()=>1000});
 const challenge=await auth.issue(WALLET,"mainnet-beta");
 const signature=Buffer.from(nacl.sign.detached(Buffer.from(challenge.message),keypair.secretKey)).toString("base64");
 const results=await Promise.allSettled([auth.verify(WALLET,challenge.message,signature,"mainnet-beta"),auth.verify(WALLET,challenge.message,signature,"mainnet-beta")]);
 assert.equal(results.filter(r=>r.status==="fulfilled").length,1);assert.equal(results.filter(r=>r.status==="rejected").length,1);
 const bad=await auth.issue(WALLET,"mainnet-beta");
 await assert.rejects(auth.verify(WALLET,bad.message,"bad","mainnet-beta"),/invalid_wallet_signature/);
 await assert.rejects(auth.verify(WALLET,bad.message,signature,"mainnet-beta"),/invalid_or_expired_challenge/);
 assert.ok(verifies>=3);
});

test("expiry is inclusive at the exact timestamp", async () => {
 let now=1000;const verifier={network:"mainnet-beta",verify:async()=>({network:"mainnet-beta",genesisHash:MAINNET})};
 const auth=createNetworkBoundWalletAuth({genesisVerifier:verifier,ttlMs:10,now:()=>now});
 const challenge=await auth.issue(WALLET,"mainnet-beta");now=1010;
 await assert.rejects(auth.verify(WALLET,challenge.message,"bad","mainnet-beta"),/invalid_or_expired_challenge/);
});
