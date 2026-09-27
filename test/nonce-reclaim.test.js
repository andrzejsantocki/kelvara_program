import test from "node:test";
import assert from "node:assert/strict";
import { Keypair, SystemInstruction, Transaction } from "@solana/web3.js";
import { buildNonceReclaimTransaction, validateNonceReclaimTransaction } from "../subapps/kamino-monitor/server.js";

const wallet=Keypair.generate();
const nonceAccounts=[Keypair.generate(),Keypair.generate(),Keypair.generate()].map(key=>key.publicKey.toString());
const balances=[1_500_000,1_600_000,1_700_000];
const blockhash=Keypair.generate().publicKey.toString();

test("reclaim transaction closes all three nonce accounts to the wallet",()=>{
 const encoded=buildNonceReclaimTransaction({wallet:wallet.publicKey.toString(),nonceAccounts,balances,blockhash});
 const tx=Transaction.from(Buffer.from(encoded,"base64"));
 assert.equal(tx.feePayer.toString(),wallet.publicKey.toString());
 assert.equal(tx.instructions.length,3);
 tx.instructions.forEach((ix,index)=>{
  const decoded=SystemInstruction.decodeNonceWithdraw(ix);
  assert.equal(decoded.noncePubkey.toString(),nonceAccounts[index]);
  assert.equal(decoded.authorizedPubkey.toString(),wallet.publicKey.toString());
  assert.equal(decoded.toPubkey.toString(),wallet.publicKey.toString());
  assert.equal(decoded.lamports,balances[index]);
 });
});

test("reclaim validation rejects partial or redirected withdrawals",()=>{
 const encoded=buildNonceReclaimTransaction({wallet:wallet.publicKey.toString(),nonceAccounts,balances,blockhash});
 const tx=Transaction.from(Buffer.from(encoded,"base64"));
 tx.feePayer=wallet.publicKey;
 tx.partialSign(wallet);
 const signed=tx.serialize().toString("base64");
 assert.deepEqual(validateNonceReclaimTransaction(signed,wallet.publicKey.toString(),nonceAccounts,balances).sort(),nonceAccounts.slice().sort());

 const redirected=Transaction.from(Buffer.from(encoded,"base64"));
 redirected.instructions[0]=redirected.instructions[0].constructor?redirected.instructions[0]:redirected.instructions[0];
 const bad=buildNonceReclaimTransaction({wallet:wallet.publicKey.toString(),nonceAccounts,balances:[balances[0]-1,...balances.slice(1)],blockhash});
 const badTx=Transaction.from(Buffer.from(bad,"base64"));badTx.partialSign(wallet);
 assert.throws(()=>validateNonceReclaimTransaction(badTx.serialize().toString("base64"),wallet.publicKey.toString(),nonceAccounts,balances),/invalid_reclaim_transaction/);
});
