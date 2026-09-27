import test from "node:test";
import assert from "node:assert/strict";
import { flagsFor, makeSessionId, explorerUrl, validateTtl, evidenceFor, signatureFromConfirmationError } from "./client.js";

test("maps single and compound incident selections to stable flags",()=>{
 assert.equal(flagsFor(["paused"]),1);
 assert.equal(flagsFor(["nav_jump"]),2);
 assert.equal(flagsFor(["authority_changed"]),4);
 assert.equal(flagsFor(["paused","nav_jump","authority_changed"]),7);
 assert.throws(()=>flagsFor(["shell"]),/unsupported_scenario/);
});

test("creates unguessable 32-byte session IDs",()=>{
 const first=makeSessionId();const second=makeSessionId();
 assert.equal(first.length,32);assert.equal(second.length,32);assert.notDeepEqual(first,second);
});

test("bounds public session TTL and creates devnet explorer links",()=>{
 assert.equal(validateTtl(30),30);assert.equal(validateTtl(300),300);assert.throws(()=>validateTtl(301),/ttl/);
 assert.equal(explorerUrl("signature","abc"),"https://explorer.solana.com/tx/abc?cluster=devnet");
 assert.equal(explorerUrl("address","xyz"),"https://explorer.solana.com/address/xyz?cluster=devnet");
});

test("normalizes confirmed on-chain state into cluster-safe monitoring evidence",()=>{
 const evidence=evidenceFor({sessionPda:"Pda111",flags:5,signature:"sig111",slot:42,observedAt:"2026-09-26T12:00:00.000Z"});
 assert.equal(evidence.cluster,"devnet");assert.equal(evidence.source.type,"monitoring_backend");assert.equal(evidence.source.transactionSignature,"sig111");assert.equal(evidence.slot,42);assert.deepEqual(evidence.value,{paused:true,navJump:false,authorityChanged:true,scenarioFlags:5});assert.equal(evidence.subject.id,"Pda111");
});

test("recovers the submitted signature from an RPC confirmation timeout",()=>{
 const signature="3Hnk4d5eW99vtqhne1pixomKCJyHqUx6FTCNp4aX8GmswAG5R7XbpdM5CuioE9bkPZzxAzy4GWBN3UCQ7dVe87nV";
 assert.equal(signatureFromConfirmationError(new Error(`Transaction was not confirmed. Check signature ${signature} using Explorer.`)),signature);
 assert.equal(signatureFromConfirmationError(new Error("unrelated")),null);
});
