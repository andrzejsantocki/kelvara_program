import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import nacl from "tweetnacl";
import { PublicKey } from "@solana/web3.js";
import { encodeBase58 } from "../../src/platform/solana/base58.js";

const AUTH_PREFIX="Kelvara wallet authentication";

function parseDecimal(value,decimals){
 const match=String(value).match(/^(\d+)(?:\.(\d+))?$/);if(!match)throw new Error("invalid_share_amount");
 const fraction=match[2]||"";if(fraction.length>decimals)throw new Error("share_precision_exceeded");
 return BigInt(match[1])*10n**BigInt(decimals)+BigInt(fraction.padEnd(decimals,"0")||"0");
}
function littleEndian(value,bytes){const out=Buffer.alloc(bytes);let n=value;for(let i=0;i<bytes;i++){out[i]=Number(n&255n);n>>=8n}if(n)throw new Error("amount_overflow");return out}
export function exactShareBytes(shares,decimals=6){const rawShares=parseDecimal(shares,decimals),farmScaled=rawShares*10n**18n;return{rawShares,farmScaled,vaultAmount:littleEndian(rawShares,8),farmAmount:littleEndian(farmScaled,16)}}

export function createWalletAuth({ttlMs=5*60_000,now=()=>Date.now(),linkWallet=null,network="mainnet-beta"}={}){
 const challenges=new Map(),sessions=new Map(),links=new Map();
 function acceptLink(event){const fingerprint=createHash("sha256").update(JSON.stringify(event)).digest("hex"),prior=links.get(event.idempotencyKey);if(prior&&prior!==fingerprint)throw new Error("idempotency_conflict");links.set(event.idempotencyKey,fingerprint);return {accepted:true,idempotent:Boolean(prior)}}
 return{
  issue(wallet,requestedNetwork=network){new PublicKey(wallet);if(requestedNetwork!==network)throw new Error("invalid_network");const nonce=randomBytes(24).toString("base64url"),challengeId=createHash("sha256").update(nonce).digest("hex"),expiresAt=now()+ttlMs,message=`${AUTH_PREFIX}\nWallet: ${wallet}\nNetwork: ${network}\nChallenge: ${challengeId}\nNonce: ${nonce}\nExpires: ${expiresAt}`;challenges.set(nonce,{wallet,message,challengeId,network,expiresAt});return{message,expiresAt,network,challengeId}},
  verify(wallet,message,signature,requestedNetwork=network){const nonce=/\nNonce: ([^\n]+)/.exec(message)?.[1],entry=nonce&&challenges.get(nonce);if(!entry||entry.wallet!==wallet||entry.message!==message||entry.network!==requestedNetwork||entry.expiresAt<now())throw new Error("invalid_or_expired_challenge");const ok=nacl.sign.detached.verify(Buffer.from(message),Buffer.from(signature,"base64"),new PublicKey(wallet).toBytes());if(!ok)throw new Error("invalid_wallet_signature");const event={schemaVersion:"verified-wallet-link/v1",chain:"solana",network:entry.network,walletAddress:wallet,verification:{method:"solana-wallet-signature",verifiedAt:new Date(now()).toISOString(),challengeId:entry.challengeId},idempotencyKey:createHash("sha256").update(`${entry.network}\\0${wallet}\\0${entry.challengeId}`).digest("hex")};const finish=()=>{challenges.delete(nonce);const token=randomBytes(32).toString("base64url");sessions.set(createHash("sha256").update(token).digest("hex"),{wallet,network:entry.network,expiresAt:now()+ttlMs});return{token,expiresAt:now()+ttlMs}};const accept=result=>{if(!result||result.accepted!==true||Object.keys(result).some(key=>!["accepted","idempotent"].includes(key)))throw new Error("wallet_link_unavailable");return finish()};if(linkWallet){try{const result=linkWallet(event);return result&&typeof result.then==="function"?result.then(accept).catch(()=>{throw new Error("wallet_link_unavailable")}):accept(result)}catch{throw new Error("wallet_link_unavailable")}}acceptLink(event);return finish()},
  authorize(token){if(!token)throw new Error("authentication_required");const key=createHash("sha256").update(token).digest("hex"),session=sessions.get(key);if(!session||session.expiresAt<now())throw new Error("authentication_required");return session.wallet},acceptLink
 }
} 

export function createControlPlaneWalletLinkClient({url,token,fetchImpl=fetch}={}){if(!url||!token)throw new Error("wallet_link_client_config_missing");const endpoint=new URL("/internal/v1/wallet-links",url).toString();return async event=>{let response;try{response=await fetchImpl(endpoint,{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${token}`},body:JSON.stringify(event),signal:AbortSignal.timeout(2000)});}catch{throw new Error("wallet_link_unavailable")}if(!response.ok)throw new Error("wallet_link_unavailable");let body;try{body=await response.json()}catch{throw new Error("wallet_link_unavailable")}if(!body||body.accepted!==true||Object.keys(body).some(key=>!["accepted","idempotent"].includes(key)))throw new Error("wallet_link_unavailable");return body}}

export const WALLET_LINK_ENDPOINT="/internal/v1/wallet-links"; 

function normalizedKey(key){const value=Buffer.isBuffer(key)?key:Buffer.from(key,"base64");if(value.length!==32)throw new Error("protection_key_must_be_32_bytes");return value}
export function createProtectionStore({path,key}){const secret=normalizedKey(key);let queue=Promise.resolve();
 async function loadAll(){try{const envelope=JSON.parse(await readFile(path,"utf8")),iv=Buffer.from(envelope.iv,"base64"),tag=Buffer.from(envelope.tag,"base64"),ciphertext=Buffer.from(envelope.ciphertext,"base64"),decipher=createDecipheriv("aes-256-gcm",secret,iv);decipher.setAuthTag(tag);return JSON.parse(Buffer.concat([decipher.update(ciphertext),decipher.final()]).toString("utf8"))}catch(error){if(error.code==="ENOENT")return{};throw error}}
 async function persist(all){await mkdir(dirname(path),{recursive:true});const iv=randomBytes(12),cipher=createCipheriv("aes-256-gcm",secret,iv),ciphertext=Buffer.concat([cipher.update(JSON.stringify(all)),cipher.final()]),envelope=JSON.stringify({v:1,iv:iv.toString("base64"),tag:cipher.getAuthTag().toString("base64"),ciphertext:ciphertext.toString("base64")}),temp=`${path}.${process.pid}.tmp`;await writeFile(temp,envelope,{mode:0o600});await rename(temp,path)}
 return{async save(wallet,record){queue=queue.then(async()=>{const all=await loadAll();all[wallet]={...record,wallet,updatedAt:new Date().toISOString()};await persist(all)});await queue;return this.get(wallet)},async get(wallet){await queue;const all=await loadAll();return all[wallet]||null},async remove(wallet){queue=queue.then(async()=>{const all=await loadAll();delete all[wallet];await persist(all)});await queue}}
}

export async function runFeeLadder(record,{nonceCurrent,submit,status,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),attemptWaitMs=4000}){
 const variants=[...record.variants].sort((a,b)=>a.priorityMicroLamports-b.priorityMicroLamports),failed=new Set();
 async function reconcile(){for(const variant of variants){const state=await status(variant.signature);if(state?.err){failed.add(variant.signature);continue}if(["confirmed","finalized"].includes(state?.confirmationStatus))return{signature:variant.signature,status:state}}return null}
 const existing=await reconcile();if(existing)return existing;
 for(const variant of variants){if(failed.has(variant.signature))continue;const landed=await reconcile();if(landed)return landed;if(!await nonceCurrent(variant)){failed.add(variant.signature);continue}await submit(variant);for(let i=0;i<2;i++){const result=await reconcile();if(result)return result;if(failed.has(variant.signature))break;await wait(attemptWaitMs)}}
 throw new Error("No armed transaction confirmed. Inspect every signature and nonce before retrying.")
}

export function transactionSignature(transaction){return encodeBase58(transaction.signatures[0])}
