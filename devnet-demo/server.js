import http from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { flagsFor, validateTtl, explorerUrl, evidenceFor } from "./client.js";

const root=join(dirname(fileURLToPath(import.meta.url)),"web");
const web3Bundle=join(dirname(fileURLToPath(import.meta.url)),"node_modules/@solana/web3.js/lib/index.iife.min.js");
const splBundle=join(dirname(fileURLToPath(import.meta.url)),"node_modules/@solana/spl-token/lib/cjs/index.js");
const assets=new Map([["/",["index.html","text/html; charset=utf-8"]],["/app.js",["app.js","text/javascript; charset=utf-8"]],["/styles.css",["styles.css","text/css; charset=utf-8"]],["/saturn-mark.svg",["saturn-mark.svg","image/svg+xml"]],["/kelvara-icon.png",["kelvara-icon.png","image/png"]]]);
function json(response,status,value){response.writeHead(status,{"content-type":"application/json; charset=utf-8","cache-control":"no-store"});response.end(JSON.stringify(value))}
async function body(request){const chunks=[];for await(const chunk of request){chunks.push(chunk);if(chunks.reduce((n,c)=>n+c.length,0)>100_000)throw new Error("request_too_large")}if(!chunks.length)return{};return JSON.parse(Buffer.concat(chunks).toString("utf8"))}
function clientId(request){return request.headers["x-forwarded-for"]?.split(",")[0].trim()||request.socket.remoteAddress||"unknown"}
function exposed(record){const {permitTransaction,...safe}=record;return{...safe,explorer:{session:explorerUrl("address",record.sessionPda),initialize:explorerUrl("signature",record.signature)}}}

export function createDemoServer({chain,monitor=null,clock=Date.now,schedule=setTimeout}={}){
 if(!chain)throw new TypeError("chain_adapter_required");
 const sessions=new Map();const activeByWallet=new Map();const idempotency=new Map();const sseStreams=new Map();const activityMetadata=new Map();
 function recordActivity(wallet,signature,metadata){if(!wallet||!signature||signature.startsWith("already"))return;if(!activityMetadata.has(wallet))activityMetadata.set(wallet,new Map());activityMetadata.get(wallet).set(signature,metadata)}
 function broadcast(sessionId,data){for(const response of sseStreams.get(sessionId)||[]){try{response.write(`data: ${JSON.stringify(data)}\n\n`)}catch{}}}
 function owned(request,id){const record=sessions.get(id);if(!record)return{error:[404,{error:"session_not_found"}]};if(record.owner!==clientId(request))return{error:[403,{error:"session_owner_mismatch"}]};return{record}}
 async function reset(record){
  if(!record.active)return{status:"baseline",monitoring:[]};
  const result=await chain.reset({sessionId:record.sessionId,sessionPda:record.sessionPda});
  const evidence=evidenceFor({sessionPda:record.sessionPda,flags:0,signature:result.signature,slot:result.slot??0,observedAt:result.observedAt});
  const monitoring=monitor?await monitor.publish(evidence):[];
  record.active=false;record.status="baseline";activeByWallet.delete(record.walletKey);
  broadcast(record.id,{event:"reset_confirmed",signature:result.signature,status:"baseline"});
  return{...result,status:"baseline",evidence,monitoring,explorer:explorerUrl("signature",result.signature)};
 }
 const server=http.createServer(async(request,response)=>{try{
  const url=new URL(request.url,"http://localhost");
  if(request.method==="GET"&&url.pathname==="/api/health")return json(response,200,{service:"devnet-scenario-capsule",cluster:"devnet",programId:chain.programId,mint:chain.mint,status:"ready"});
  const walletActivity=url.pathname.match(/^\/api\/wallets\/([^/]+)\/activity$/);if(request.method==="GET"&&walletActivity){if(!chain.walletActivity)return json(response,501,{error:"wallet_activity_unavailable"});const publicKey=decodeURIComponent(walletActivity[1]);const activity=await chain.walletActivity({publicKey,limit:10});const known=activityMetadata.get(publicKey)||new Map();activity.transactions=activity.transactions.map(tx=>({...tx,protocol:"Solana",action:"Solana transaction",icon:"wallet",...(known.get(tx.signature)||{})}));return json(response,200,activity)}
  if(request.method==="GET"&&url.pathname==="/solana-web3.js"){response.writeHead(200,{"content-type":"text/javascript; charset=utf-8","cache-control":"public, max-age=3600"});return response.end(await readFile(web3Bundle))}
  if(request.method==="POST"&&url.pathname==="/api/sandbox/fund"){
   const input=await body(request);if(!input.publicKey)return json(response,400,{error:"public_key_required"});
   const result=await chain.fundBurner({recipientPubkey:input.publicKey});recordActivity(input.publicKey,result.signature,{protocol:"Solana",action:"Wallet funded",icon:"wallet",amount:result.balanceUsdc,asset:"USDC"});
   return json(response,200,{funded:true,...result,explorer:result.signature&&!result.signature.startsWith("already")?explorerUrl("signature",result.signature):null});
  }
  if(request.method==="POST"&&url.pathname==="/api/sessions"){
   const input=await body(request);const owner=clientId(request);const walletKey=`${owner}:${input.ownerPubkey||"anonymous"}`;const active=activeByWallet.get(walletKey);const existing=active&&sessions.get(active);if(existing?.active)return json(response,200,{...exposed(existing),restored:true});
   const activeForClient=[...sessions.values()].filter(record=>record.owner===owner&&record.active).length;if(activeForClient>=8)return json(response,429,{error:"active_session_limit",message:"This client already has the maximum number of active demo capsules."});
   const ttlSeconds=validateTtl(input.ttlSeconds??300);const chainResult=await chain.initialize({ttlSeconds,ownerPubkey:input.ownerPubkey});
   const record={id:randomUUID(),owner,walletKey,ownerPubkey:input.ownerPubkey||null,monitoredAuthority:chain.payerPubkey,active:true,status:"created",ttlSeconds,createdAt:new Date(clock()).toISOString(),deposited:false,armed:false,...chainResult};
   sessions.set(record.id,record);activeByWallet.set(walletKey,record.id);const timer=schedule(()=>reset(record).catch(error=>console.error("automatic_reset_failed",error.message)),ttlSeconds*1000);timer?.unref?.();return json(response,201,exposed(record));
  }
  const stream=url.pathname.match(/^\/api\/sessions\/([^/]+)\/stream$/);
  if(request.method==="GET"&&stream){const record=sessions.get(stream[1]);if(!record)return json(response,404,{error:"session_not_found"});response.writeHead(200,{"content-type":"text/event-stream","cache-control":"no-store","connection":"keep-alive"});response.write(": connected\n\n");if(!sseStreams.has(record.id))sseStreams.set(record.id,new Set());sseStreams.get(record.id).add(response);request.on("close",()=>sseStreams.get(record.id)?.delete(response));return}
  const action=url.pathname.match(/^\/api\/sessions\/([^/]+)\/(deposit\/prepare|deposit\/submit|protection\/prepare|protection\/submit|trigger|reset)$/);
  if(request.method==="POST"&&action){
   const access=owned(request,action[1]);if(access.error)return json(response,...access.error);const record=access.record;const input=await body(request);
   if(action[2]==="deposit/prepare"){
    if(record.deposited)return json(response,409,{error:"position_already_deposited"});const amount=Number(input.amount);if(!Number.isFinite(amount)||amount<=0||amount>1000)return json(response,400,{error:"invalid_deposit_amount"});
    const prepared=await chain.prepareDeposit({sessionPda:record.sessionPda,ownerPubkey:record.ownerPubkey,amount});record.pendingDeposit=prepared;return json(response,200,prepared);
   }
   if(action[2]==="deposit/submit"){
    if(!record.pendingDeposit)return json(response,409,{error:"deposit_not_prepared"});if(typeof input.signedTransaction!=="string"||!input.signedTransaction)return json(response,400,{error:"signed_transaction_required"});
    const result=await chain.submitDeposit({signedTransaction:input.signedTransaction,...record.pendingDeposit});record.deposited=true;record.status="naked";record.amount=result.amount??record.pendingDeposit.amount;record.positionPda=result.positionPda??record.pendingDeposit.positionPda;recordActivity(record.ownerPubkey,result.signature,{protocol:"Saturn Earn",action:"Vault deposit",icon:"saturn",amount:record.amount,asset:"USDC"});delete record.pendingDeposit;return json(response,200,{...result,status:"naked",explorer:explorerUrl("signature",result.signature)});
   }
   if(action[2]==="protection/prepare"){
    if(!record.deposited)return json(response,409,{error:"deposit_required"});if(record.armed)return json(response,409,{error:"protection_already_armed"});
    const prepared=await chain.prepareProtection({sessionPda:record.sessionPda,positionPda:record.positionPda,ownerPubkey:record.ownerPubkey,amount:record.amount});record.pendingProtection=prepared;return json(response,200,{...prepared,treasuryAddress:chain.treasuryTokenPubkey,treasuryExplorer:explorerUrl("address",chain.treasuryTokenPubkey)});
   }
   if(action[2]==="protection/submit"){
    if(!record.pendingProtection)return json(response,409,{error:"protection_not_prepared"});if(!input.signedArmTransaction||!input.signedPermitTransaction)return json(response,400,{error:"signed_transactions_required"});
    const fee=record.pendingProtection.fee;const result=await chain.submitProtection({signedArmTransaction:input.signedArmTransaction,signedPermitTransaction:input.signedPermitTransaction,...record.pendingProtection});record.armed=true;record.status="armed";record.fee=fee;record.protectedAmount=record.amount;record.permitTransaction=result.permitTransaction||input.signedPermitTransaction;record.noncePubkey=result.noncePubkey;recordActivity(record.ownerPubkey,result.signature,{protocol:"Kelvara",action:"Protection fee paid",icon:"kelvara",amount:fee,asset:"USDC"});delete record.pendingProtection;broadcast(record.id,{event:"permit_armed",noncePubkey:record.noncePubkey});return json(response,200,{...result,status:"armed",explorer:explorerUrl("signature",result.signature)});
   }
   if(action[2]==="trigger"){
    if(typeof input.idempotencyKey!=="string"||input.idempotencyKey.length<1||input.idempotencyKey.length>128)return json(response,400,{error:"idempotency_key_required"});const key=`${record.id}:${input.idempotencyKey}`;if(idempotency.has(key))return json(response,200,idempotency.get(key));
    const flags=flagsFor(input.scenarios||[]);const result=await chain.trigger({sessionId:record.sessionId,sessionPda:record.sessionPda,flags});const evidence=evidenceFor({sessionPda:record.sessionPda,flags,signature:result.signature,slot:result.slot??0,observedAt:result.observedAt});const monitoring=monitor?await monitor.publish(evidence):[];
    broadcast(record.id,{event:"attack_confirmed",slot:result.slot,signature:result.signature,flags,explorer:explorerUrl("signature",result.signature)});
    recordActivity(record.ownerPubkey,result.signature,{protocol:"Kelvara",action:"Breach evidence",icon:"kelvara"});let evacuation=null;if(record.armed){broadcast(record.id,{event:"sentry_detection",message:"Invariant breach confirmed from finalized account state."});evacuation=await chain.executeEvacuation({signedTransaction:record.permitTransaction,noncePubkey:record.noncePubkey,sessionPda:record.sessionPda});evacuation.amount=record.protectedAmount;recordActivity(record.ownerPubkey,evacuation.signature,{protocol:"Kelvara",action:"Emergency evacuation",icon:"kelvara",amount:evacuation.amount,asset:"USDC"});broadcast(record.id,{event:"evacuation_confirmed",...evacuation,explorer:explorerUrl("signature",evacuation.signature)});record.status="evacuated"}else record.status="breach-active";
    const authorities={before:chain.payerPubkey,now:record.sessionPda,source:"scenario_capsule"};const value={...result,flags,status:record.status,evidence,monitoring,authorities,explorer:explorerUrl("signature",result.signature),evacuation};idempotency.set(key,value);return json(response,200,value);
   }
   return json(response,200,await reset(record));
  }
  if((request.method==="GET"||request.method==="HEAD")&&assets.has(url.pathname)){const [name,type]=assets.get(url.pathname);response.writeHead(200,{"content-type":type,"cache-control":"no-store"});if(request.method==="HEAD")return response.end();return response.end(await readFile(join(root,name)))}
  return json(response,404,{error:"not_found"});
 }catch(error){const message=error instanceof Error?error.message:String(error);const status=/ttl|scenario|required|amount|JSON|too_large/.test(message)?400:500;json(response,status,{error:status===400?"invalid_request":"server_error",message})}});
 return server;
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
 const [{createChainAdapter},{createAlertMonitor}]=await Promise.all([import("./solana-chain.js"),import("./alert-monitor.js")]);const server=createDemoServer({chain:await createChainAdapter(),monitor:createAlertMonitor()});const port=Number(process.env.PORT||7640);server.listen(port,"127.0.0.1",()=>console.log(`Kelvara Devnet Demo: http://127.0.0.1:${port}`));
}
