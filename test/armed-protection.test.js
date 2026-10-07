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
 assert.match(challenge.message,/^Kelvara wallet authentication\n/);
 assert.doesNotMatch(challenge.message,/protection authentication/i);
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
 assert.ok(app.includes("activateMonitoring()"));
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
 const dir=await mkdtemp(join(tmpdir(),"kelvara-api-")),store=createProtectionStore({path:join(dir,"armed.enc"),key:Buffer.alloc(32,9)}),auth=createWalletAuth(),keypair=Keypair.generate(),observations=[];
 const server=createKaminoMonitorServer({inspector:{inspect:async()=>({position:null})},protectionStore:store,walletAuth:auth,allowLegacyAuthForTests:true,validateArmedBundle:async bundle=>bundle,operationsSink:{record:async value=>observations.push(value)}});server.listen(0,"127.0.0.1");await once(server,"listening");const base=`http://127.0.0.1:${server.address().port}`;
 try{const challenge=await(await fetch(`${base}/api/auth/challenge`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({wallet:keypair.publicKey.toString(),network:"mainnet-beta"})})).json();const signature=Buffer.from(nacl.sign.detached(Buffer.from(challenge.message),keypair.secretKey)).toString("base64");const session=await(await fetch(`${base}/api/auth/verify`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({wallet:keypair.publicKey.toString(),message:challenge.message,signature})})).json();
  const unauthorized=await fetch(`${base}/api/protection/status`);assert.equal(unauthorized.status,401);
  const variants=[10,50,100].map((fee,index)=>({signature:`sig${index}`,signedTransaction:`tx${index}`,priorityMicroLamports:fee}));const armed=await(await fetch(`${base}/api/protection/arm`,{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${session.token}`},body:JSON.stringify({nonceAccount:WALLET,nonceValue:"nonce",shares:"0.1",variants})})).json();assert.equal(armed.armedCount,3);
  const status=await(await fetch(`${base}/api/protection/status`,{headers:{authorization:`Bearer ${session.token}`}})).json();assert.equal(status.armedCount,3);assert.equal(status.variants[0].signedTransaction,undefined);assert.equal(status.monitoring.active,true);assert.equal(status.monitoring.consentSource,"durable_nonce_bundle_signature");assert.equal(status.monitoring.network,"mainnet-beta");
  const stored=await store.get(keypair.publicKey.toString());assert.equal(stored.monitoring.active,true);assert.equal(stored.monitoring.protocol,"Kamino Earn");assert.equal(stored.monitoring.vault,KAMINO.vault);
  assert.equal(observations.length,1);assert.equal(observations[0].event,"protection_armed");assert.equal(observations[0].walletId,keypair.publicKey.toString());
 }finally{server.close();await once(server,"close");await rm(dir,{recursive:true,force:true})}
});

test("protection status remains available when chain nonce recovery is unavailable",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"kelvara-recovery-failure-")),store=createProtectionStore({path:join(dir,"armed.enc"),key:Buffer.alloc(32,6)}),auth=createWalletAuth(),keypair=Keypair.generate();
 const recoverPendingNonceSetup=async()=>{throw new Error("rpc_http_429")};
 const server=createKaminoMonitorServer({inspector:{inspect:async()=>({position:null})},protectionStore:store,walletAuth:auth,allowLegacyAuthForTests:true,recoverPendingNonceSetup});server.listen(0,"127.0.0.1");await once(server,"listening");const base=`http://127.0.0.1:${server.address().port}`;
 try{const challenge=await(await fetch(`${base}/api/auth/challenge`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({wallet:keypair.publicKey.toString(),network:"mainnet-beta"})})).json(),signature=Buffer.from(nacl.sign.detached(Buffer.from(challenge.message),keypair.secretKey)).toString("base64"),session=await(await fetch(`${base}/api/auth/verify`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({wallet:keypair.publicKey.toString(),message:challenge.message,signature})})).json();
  const response=await fetch(`${base}/api/protection/status`,{headers:{authorization:`Bearer ${session.token}`}}),status=await response.json();
  assert.equal(response.status,200);assert.equal(status.armed,false);assert.deepEqual(status.pendingNonceAccounts,[]);assert.equal(status.recoveryUnavailable,true);
 }finally{server.close();await once(server,"close");await rm(dir,{recursive:true,force:true})}
});

test("protection status recovers confirmed nonce setup for reconnecting wallet",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"kelvara-recovery-")),store=createProtectionStore({path:join(dir,"armed.enc"),key:Buffer.alloc(32,7)}),auth=createWalletAuth(),keypair=Keypair.generate(),nonceAccounts=[Keypair.generate(),Keypair.generate(),Keypair.generate()].map(key=>key.publicKey.toString());
 const recoverPendingNonceSetup=async wallet=>({wallet,nonceAccounts,setupSignature:"confirmed-setup",setupConfirmed:true});
 const server=createKaminoMonitorServer({inspector:{inspect:async()=>({position:null})},protectionStore:store,walletAuth:auth,allowLegacyAuthForTests:true,recoverPendingNonceSetup});server.listen(0,"127.0.0.1");await once(server,"listening");const base=`http://127.0.0.1:${server.address().port}`;
 try{const challenge=await(await fetch(`${base}/api/auth/challenge`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({wallet:keypair.publicKey.toString(),network:"mainnet-beta"})})).json(),signature=Buffer.from(nacl.sign.detached(Buffer.from(challenge.message),keypair.secretKey)).toString("base64"),session=await(await fetch(`${base}/api/auth/verify`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({wallet:keypair.publicKey.toString(),message:challenge.message,signature})})).json();
  const status=await(await fetch(`${base}/api/protection/status`,{headers:{authorization:`Bearer ${session.token}`}})).json();
  assert.equal(status.armed,false);assert.equal(status.setupConfirmed,true);assert.deepEqual(status.pendingNonceAccounts,nonceAccounts);assert.equal(status.setupSignature,"confirmed-setup");
  const stored=await store.get(keypair.publicKey.toString());assert.deepEqual(stored.pendingNonceAccounts,nonceAccounts);
 }finally{server.close();await once(server,"close");await rm(dir,{recursive:true,force:true})}
});

test("arming click opens review before any wallet or network wait",async()=>{
 const app=await readFile(new URL("../subapps/kamino-monitor/web/app.js",import.meta.url),"utf8"),body=app.match(/function openArmingReview\(\)\{.*?\n(?=function closeArmingReview)/s)?.[0]||"";
 assert.match(body,/arming-review-message/);
 assert.match(body,/classList\.remove\("hidden"\)/);
 assert.doesNotMatch(body,/fetch\(|authenticateProtection|protectionRequest|signMessage|signTransaction/);
});

test("frontend reuses backend-recovered nonce accounts before generating keys",async()=>{
 const app=await readFile(new URL("../subapps/kamino-monitor/web/app.js",import.meta.url),"utf8");
 assert.match(app,/protectionStatus\?\.pendingNonceAccounts/);
 assert.match(app,/pendingNonceAccounts\?\.length===3/);
 assert.match(app,/Recovered three confirmed nonce accounts/);
 assert.match(app,/async function runProtectionSetup/);
});

test("wallet connection stays read-only until the user continues from the arming review",async()=>{
 const app=await readFile(new URL("../subapps/kamino-monitor/web/app.js",import.meta.url),"utf8");
 const connectBody=app.match(/async function connectWallet\(kind\)\{.*?\n(?=async function viewAddress)/s)?.[0]||"";
 assert.match(connectBody,/await inspect\(\)/);
 assert.doesNotMatch(connectBody,/authenticateProtection|loadProtection|signMessage/);
 const continueBody=app.match(/async function continueArming\(\)\{.*?\n(?=async function runProtectionSetup)/s)?.[0]||"";
 assert.match(continueBody,/await authenticateProtection\(\)/);
 assert.match(continueBody,/await runProtectionSetup\(\)/);
});

test("arming review fits mobile viewport and keeps actions reachable",async()=>{
 const css=await readFile(new URL("../subapps/kamino-monitor/web/styles.css",import.meta.url),"utf8");
 assert.match(css,/\.arming-review-card\{[^}]*max-height:calc\(100(?:dvh|svh) - 24px\)[^}]*overflow:hidden/);
 assert.match(css,/@media\(max-width:620px\)[\s\S]*?\.arming-review-card\{[^}]*width:100%[^}]*padding:20px 16px/);
 assert.match(css,/@media\(max-width:760px\)[\s\S]*?\.portfolio-shell\{grid-template-columns:1fr/);
 assert.match(css,/@media\(max-width:760px\)[\s\S]*?\.mini-chain\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
 assert.match(css,/@media\(max-width:760px\)[\s\S]*?\.mini-chain>i\{display:none/);
 assert.match(css,/\.arming-review-card\{[^}]*overflow:hidden[^}]*display:flex[^}]*flex-direction:column/);
 assert.match(css,/\.arming-review-body\{[^}]*overflow-y:auto[^}]*min-height:0/);
 assert.match(css,/\.arming-review-actions\{[^}]*flex:none/);
 assert.match(css,/\.arming-review-card \.selector-head>button\{[^}]*min-width:44px[^}]*min-height:44px/);
 assert.doesNotMatch(css,/\.arming-review-card\{[^}]*min-width:/);
});

test("position exposes direct arming and a consolidated material-action review",async()=>{
 const root=new URL("../",import.meta.url),html=await readFile(new URL("subapps/kamino-monitor/web/index.html",root),"utf8"),app=await readFile(new URL("subapps/kamino-monitor/web/app.js",root),"utf8");
 assert.match(html,/id="position-arm-protection"[^>]*>Arm protection</);
 assert.match(html,/id="arming-review"/);
 for(const disclosure of ["three user-controlled durable nonce accounts","reclaimable rent","setup network fee","exact detected share amount","destination token account","three pre-signed transactions","Low, medium, and high fee tiers","stored encrypted","No withdrawal happens during setup","Fast close","Revoke protection"])assert.match(html,new RegExp(disclosure,"i"));
 assert.match(html,/id="continue-arming"[^>]*>Continue to wallet</);
 assert.match(app,/function openArmingReview/);
 assert.match(app,/\$\("#position-arm-protection"\)\.onclick=openArmingReview/);
 assert.match(app,/\$\("#continue-arming"\)\.onclick=continueArming/);
});

test("arming review is populated with exact position and destination data before signing",async()=>{
 const app=await readFile(new URL("../subapps/kamino-monitor/web/app.js",import.meta.url),"utf8");
 const reviewBody=app.match(/function openArmingReview\(\)\{.*?\n(?=function closeArmingReview)/s)?.[0]||"";
 assert.match(reviewBody,/evidence\.position\.totalShares/);
 assert.match(reviewBody,/evidence\.position\.underlyingAmount/);
 assert.match(reviewBody,/walletAddress/);
 assert.match(reviewBody,/arming-destination-token-account/);
 assert.doesNotMatch(reviewBody,/authenticateProtection|signMessage|signTransaction|signAllTransactions/);
});

test("confirmed manual evacuation finalizes the persisted armed record",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"kelvara-manual-finalize-")),store=createProtectionStore({path:join(dir,"armed.enc"),key:Buffer.alloc(32,8)}),auth=createWalletAuth(),keypair=Keypair.generate(),wallet=keypair.publicKey.toString(),manualSignature="manual-confirmed-signature";
 await store.save(wallet,{wallet,shares:"1",variants:[0,1,2].map(index=>({signature:`armed-${index}`,nonceAccount:Keypair.generate().publicKey.toString(),priorityMicroLamports:index}))});
 const server=createKaminoMonitorServer({inspector:{inspect:async()=>({position:null})},protectionStore:store,walletAuth:auth,allowLegacyAuthForTests:true,finalizeManualEvacuation:async(signature,authenticatedWallet)=>{assert.equal(signature,manualSignature);assert.equal(authenticatedWallet,wallet);return{signature,confirmedAt:"2026-09-27T14:52:11.000Z"}}});server.listen(0,"127.0.0.1");await once(server,"listening");const base=`http://127.0.0.1:${server.address().port}`;
 try{const challenge=await(await fetch(`${base}/api/auth/challenge`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({wallet,network:"mainnet-beta"})})).json(),signed=Buffer.from(nacl.sign.detached(Buffer.from(challenge.message),keypair.secretKey)).toString("base64"),session=await(await fetch(`${base}/api/auth/verify`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({wallet,message:challenge.message,signature:signed})})).json();
  const finalized=await(await fetch(`${base}/api/protection/manual-evacuation/finalize`,{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${session.token}`},body:JSON.stringify({signature:manualSignature})})).json();assert.equal(finalized.completedAt,"2026-09-27T14:52:11.000Z");assert.equal(finalized.completionMode,"manual");assert.equal(finalized.winner,manualSignature);
  const stored=await store.get(wallet);assert.equal(stored.completedAt,"2026-09-27T14:52:11.000Z");assert.equal(stored.completionMode,"manual");assert.equal(stored.revocationRequired.length,3);
 }finally{server.close();await once(server,"close");await rm(dir,{recursive:true,force:true})}
});

test("frontend records manual evacuation after confirmation",async()=>{
 const app=await readFile(new URL("../subapps/kamino-monitor/web/app.js",import.meta.url),"utf8");
 assert.match(app,/manual-evacuation\/finalize/);
 assert.match(app,/signature:submitted\.signature/);
 assert.match(app,/evacuationAvailable=status\.armed&&\!status\.completedAt/);
});

test("embedded evacuation client authenticates and binds prepare submit status requests",async()=>{
 const {createApiClient}=await import("../subapps/kamino-monitor/web/evacuation-client.js");
 const calls=[];let token=null;let authenticated=0;
 const client=createApiClient({apiUrl:path=>`https://api.test${path}`,network:"mainnet-beta",getGenesis:()=>"server-genesis",getToken:()=>token,authenticate:async()=>{authenticated++;token="server-token"},fetchImpl:async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify({ok:true}),{status:200})}});
 await client.post("/api/evacuation/prepare",{wallet:"wallet"},{authenticated:true});
 await client.post("/api/evacuation/submit",{wallet:"wallet",signedTransaction:"signed"},{authenticated:true});
 await client.request("/api/evacuation/status/signature",{authenticated:true});
 assert.equal(authenticated,1);
 assert.deepEqual(calls.map(call=>call.url),["https://api.test/api/evacuation/prepare","https://api.test/api/evacuation/submit","https://api.test/api/evacuation/status/signature"]);
 for(const {options} of calls){assert.equal(options.headers.authorization,"Bearer server-token");assert.equal(options.headers["x-kelvara-network"],"mainnet-beta");assert.equal(options.headers["x-kelvara-genesis"],"server-genesis")}
 assert.deepEqual(JSON.parse(calls[0].options.body),{wallet:"wallet",network:"mainnet-beta"});
});
