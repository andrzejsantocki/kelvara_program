import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import nacl from "tweetnacl";
import { ComputeBudgetProgram, Keypair, PublicKey, SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { createProtectionStore, createWalletAuth, exactShareBytes, runFeeLadder } from "../subapps/kamino-monitor/protection.js";
import { buildArmedVariants, createKaminoMonitorServer, KAMINO } from "../subapps/kamino-monitor/server.js";
import { once } from "node:events";

const WALLET="883AnESJiUVzCnwowgaWCpXp4EGsK4JMVzUUUcjSSs62";

test("exact share encoding freezes farm u128 and vault u64 amounts",()=>{
 const encoded=exactShareBytes("0.113371",6);
 assert.equal(encoded.rawShares,113371n);
 assert.equal(encoded.farmScaled.toString(16),"1801daae7ab2da8c0000");
 assert.equal(encoded.vaultAmount.toString("hex"),"dbba010000000000");
 assert.equal(encoded.farmAmount.toString("hex"),"00008cdab27aaeda0118000000000000");
});

test("armed variants use independent nonces, freeze exact shares, and never close the shares account",()=>{
 const wallet=Keypair.generate().publicKey,farm=new PublicKey("FarmsPZpWu9i7Kky8tPN37rs2TpmMrAZrC7S7vJa91Hr"),vault=new PublicKey("KvauGMspG5k6rtzrqqn7WNn3oZdyKqLKwK2XWQ8FLjd"),token=new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
 const ix=(programId,data)=>new TransactionInstruction({programId,keys:[{pubkey:wallet,isSigner:true,isWritable:true}],data:Buffer.from(data,"hex")});
 const base=[ix(farm,"5a5f6b2acd7c32e100009c584c491ff2ffff63a7b3b6e00d"),ix(farm,"2466bb31dc248443"),ix(vault,"1383709baadc2239ffffffffffffffff"),ix(token,"09")];
 const nonces=[0,1,2].map(()=>({nonceAccount:Keypair.generate().publicKey.toString(),nonceValue:Keypair.generate().publicKey.toString()}));
 const variants=buildArmedVariants({wallet:wallet.toString(),nonces,shares:"0.113371",baseInstructions:base,luts:[],fees:[10,50,100]});
 assert.equal(variants.length,3);assert.equal(new Set(variants.map(v=>v.nonceAccount)).size,3);
 for(const [index,variant] of variants.entries()){const tx=VersionedTransaction.deserialize(Buffer.from(variant.transaction,"base64")),message=TransactionMessage.decompile(tx.message),programs=message.instructions.map(item=>item.programId.toString());assert.equal(tx.message.recentBlockhash,nonces[index].nonceValue);assert.equal(programs[0],SystemProgram.programId.toString());assert.equal(programs[1],ComputeBudgetProgram.programId.toString());assert.equal(programs[2],ComputeBudgetProgram.programId.toString());assert.equal(programs.at(-1),vault.toString());assert.doesNotMatch(programs.join(","),new RegExp(`${token}$`));assert.equal(Buffer.from(message.instructions[3].data).subarray(8,24).toString("hex"),"00008cdab27aaeda0118000000000000");assert.equal(Buffer.from(message.instructions.at(-1).data).subarray(8).toString("hex"),"dbba010000000000");assert.equal(variant.priorityMicroLamports,[10,50,100][index])}
});

test("wallet authentication issues one-time challenges and verifies Ed25519 signatures",()=>{
 const keypair=Keypair.generate(),auth=createWalletAuth({ttlMs:60_000});
 const challenge=auth.issue(keypair.publicKey.toString());
 const signature=nacl.sign.detached(new TextEncoder().encode(challenge.message),keypair.secretKey);
 const session=auth.verify(keypair.publicKey.toString(),challenge.message,Buffer.from(signature).toString("base64"));
 assert.equal(auth.authorize(session.token),keypair.publicKey.toString());
 assert.throws(()=>auth.verify(keypair.publicKey.toString(),challenge.message,Buffer.from(signature).toString("base64")),/challenge/);
});

test("armed transactions are encrypted at rest and wallet scoped",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"kelvara-protection-")),path=join(dir,"armed.enc"),key=Buffer.alloc(32,7);
 try{const store=createProtectionStore({path,key});await store.save(WALLET,{nonceAccount:"nonce",nonceValue:"value",variants:[{signature:"cheap",signedTransaction:"SECRET_SIGNED_BYTES",priorityMicroLamports:10}]});
  const disk=await readFile(path,"utf8");assert.doesNotMatch(disk,/SECRET_SIGNED_BYTES|cheap|nonce/);
  const loaded=await store.get(WALLET);assert.equal(loaded.variants.length,1);assert.equal(loaded.variants[0].signature,"cheap");assert.equal(await store.get("11111111111111111111111111111111"),null);
 }finally{await rm(dir,{recursive:true,force:true})}
});

test("fee ladder tries cheapest first and stops immediately after confirmation",async()=>{
 const calls=[],submitted=new Set();const result=await runFeeLadder({variants:[{signature:"high",priorityMicroLamports:100},{signature:"low",priorityMicroLamports:10},{signature:"mid",priorityMicroLamports:50}]},{
  nonceCurrent:async()=>true,
  submit:async variant=>{calls.push(`submit:${variant.signature}`);submitted.add(variant.signature);return variant.signature},
  status:async signature=>signature==="mid"&&submitted.has(signature)?{confirmationStatus:"confirmed",err:null}:null,
  wait:async()=>{}
 });
 assert.deepEqual(calls,["submit:low","submit:mid"]);assert.equal(result.signature,"mid");
});

test("fee ladder refuses execution after nonce changed",async()=>{
 let submitted=false;
 await assert.rejects(()=>runFeeLadder({variants:[{signature:"low",priorityMicroLamports:10}]},{nonceCurrent:async()=>false,submit:async()=>{submitted=true},status:async()=>null,wait:async()=>{}}),/nonce/i);
 assert.equal(submitted,false);
});

test("independent nonce ladder continues after one tier fails on-chain",async()=>{
 const calls=[],statuses=new Map();
 const result=await runFeeLadder({variants:[{signature:"low",nonceAccount:"A",priorityMicroLamports:10},{signature:"high",nonceAccount:"B",priorityMicroLamports:100}]},{nonceCurrent:async()=>true,submit:async v=>{calls.push(v.signature);statuses.set(v.signature,v.signature==="low"?{confirmationStatus:"confirmed",err:{InstructionError:[2,"Custom"]}}:{confirmationStatus:"confirmed",err:null});return v.signature},status:async sig=>statuses.get(sig)||null,wait:async()=>{}});
 assert.deepEqual(calls,["low","high"]);assert.equal(result.signature,"high");
});

test("processed is not treated as completed evacuation",async()=>{
 const calls=[],submitted=new Set(),variants=[{signature:"low",priorityMicroLamports:10},{signature:"high",priorityMicroLamports:100}];
 const result=await runFeeLadder({variants},{nonceCurrent:async()=>true,submit:async variant=>{calls.push(variant.signature);submitted.add(variant.signature);return variant.signature},status:async signature=>signature==="low"&&submitted.has("low")?{confirmationStatus:"processed",err:null}:signature==="high"&&submitted.has("high")?{confirmationStatus:"confirmed",err:null}:null,wait:async()=>{}});
 assert.deepEqual(calls,["low","high"]);assert.equal(result.signature,"high");
});

test("protection UI exposes nonce setup, armed count, fast close, and revoke",async()=>{
 const root=new URL("../",import.meta.url),html=await readFile(new URL("subapps/kamino-monitor/web/index.html",root),"utf8"),app=await readFile(new URL("subapps/kamino-monitor/web/app.js",root),"utf8");
 for(const text of ["Arm protection","armed transactions","Fast close","Revoke protection","durable nonce"])assert.match(html,new RegExp(text,"i"));
 for(const contract of ["signAllTransactions","/api/protection/prepare","/api/protection/arm","/api/protection/fast-close","/api/protection/revoke","kelvara_pending_nonce_accounts"])assert.match(app,new RegExp(contract.replaceAll("/","\\/")));
 assert.ok(app.includes("activateMonitoring({loadProtection:false})"));
 for(const binding of ['$("#arm-protection").onclick=armProtection','$("#fast-close").onclick=fastClose','$("#revoke-protection").onclick=revokeProtection'])assert.match(app,new RegExp(binding.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")));
});

test("revocation is not described as complete before on-chain confirmation",async()=>{
 const app=await readFile(new URL("../subapps/kamino-monitor/web/app.js",import.meta.url),"utf8"),server=await readFile(new URL("../subapps/kamino-monitor/server.js",import.meta.url),"utf8");
 assert.match(app,/await waitForConfirmation\(result\.signature\)/);
 assert.match(app,/\/api\/protection\/revoke\/finalize/);
 assert.match(server,/pendingRevocation/);
 assert.match(server,/revocation_not_confirmed/);
});

test("arming API requires wallet authentication and stores three signed variants",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"kelvara-api-")),store=createProtectionStore({path:join(dir,"armed.enc"),key:Buffer.alloc(32,9)}),auth=createWalletAuth(),keypair=Keypair.generate();
 const server=createKaminoMonitorServer({inspector:{inspect:async()=>({position:null})},protectionStore:store,walletAuth:auth,validateArmedBundle:async bundle=>bundle});server.listen(0,"127.0.0.1");await once(server,"listening");const base=`http://127.0.0.1:${server.address().port}`;
 try{const challenge=await(await fetch(`${base}/api/auth/challenge`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({wallet:keypair.publicKey.toString()})})).json();const signature=Buffer.from(nacl.sign.detached(Buffer.from(challenge.message),keypair.secretKey)).toString("base64");const session=await(await fetch(`${base}/api/auth/verify`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({wallet:keypair.publicKey.toString(),message:challenge.message,signature})})).json();
  const unauthorized=await fetch(`${base}/api/protection/status`);assert.equal(unauthorized.status,401);
  const variants=[10,50,100].map((fee,index)=>({signature:`sig${index}`,signedTransaction:`tx${index}`,priorityMicroLamports:fee}));const armed=await(await fetch(`${base}/api/protection/arm`,{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${session.token}`},body:JSON.stringify({nonceAccount:WALLET,nonceValue:"nonce",shares:"0.1",variants})})).json();assert.equal(armed.armedCount,3);
  const status=await(await fetch(`${base}/api/protection/status`,{headers:{authorization:`Bearer ${session.token}`}})).json();assert.equal(status.armedCount,3);assert.equal(status.variants[0].signedTransaction,undefined);assert.equal(status.monitoring.active,true);assert.equal(status.monitoring.consentSource,"durable_nonce_bundle_signature");assert.equal(status.monitoring.network,"mainnet");
  const stored=await store.get(keypair.publicKey.toString());assert.equal(stored.monitoring.active,true);assert.equal(stored.monitoring.protocol,"Kamino Earn");assert.equal(stored.monitoring.vault,KAMINO.vault);
 }finally{server.close();await once(server,"close");await rm(dir,{recursive:true,force:true})}
});

test("protection status recovers confirmed nonce setup for reconnecting wallet",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"kelvara-recovery-")),store=createProtectionStore({path:join(dir,"armed.enc"),key:Buffer.alloc(32,7)}),auth=createWalletAuth(),keypair=Keypair.generate(),nonceAccounts=[Keypair.generate(),Keypair.generate(),Keypair.generate()].map(key=>key.publicKey.toString());
 const recoverPendingNonceSetup=async wallet=>({wallet,nonceAccounts,setupSignature:"confirmed-setup",setupConfirmed:true});
 const server=createKaminoMonitorServer({inspector:{inspect:async()=>({position:null})},protectionStore:store,walletAuth:auth,recoverPendingNonceSetup});server.listen(0,"127.0.0.1");await once(server,"listening");const base=`http://127.0.0.1:${server.address().port}`;
 try{const challenge=await(await fetch(`${base}/api/auth/challenge`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({wallet:keypair.publicKey.toString()})})).json(),signature=Buffer.from(nacl.sign.detached(Buffer.from(challenge.message),keypair.secretKey)).toString("base64"),session=await(await fetch(`${base}/api/auth/verify`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({wallet:keypair.publicKey.toString(),message:challenge.message,signature})})).json();
  const status=await(await fetch(`${base}/api/protection/status`,{headers:{authorization:`Bearer ${session.token}`}})).json();
  assert.equal(status.armed,false);assert.equal(status.setupConfirmed,true);assert.deepEqual(status.pendingNonceAccounts,nonceAccounts);assert.equal(status.setupSignature,"confirmed-setup");
  const stored=await store.get(keypair.publicKey.toString());assert.deepEqual(stored.pendingNonceAccounts,nonceAccounts);
 }finally{server.close();await once(server,"close");await rm(dir,{recursive:true,force:true})}
});

test("frontend reuses backend-recovered nonce accounts before generating keys",async()=>{
 const app=await readFile(new URL("../subapps/kamino-monitor/web/app.js",import.meta.url),"utf8");
 assert.match(app,/protectionStatus\?\.pendingNonceAccounts/);
 assert.match(app,/pendingNonceAccounts\?\.length===3/);
 assert.match(app,/Nonce setup recovered/);
});
