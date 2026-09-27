import { randomBytes } from "node:crypto";

export const PROGRAM_ID="GGwyWv1goVjyTiH9tQ72uXrn2voF56eZESnM4rEwrY98";
export const SCENARIOS=Object.freeze({paused:1,nav_jump:2,authority_changed:4});

export function flagsFor(names){let flags=0;for(const name of names){const value=SCENARIOS[name];if(!value)throw new TypeError(`unsupported_scenario: ${name}`);flags|=value}if(!flags)throw new TypeError("scenario_required");return flags}
export function makeSessionId(){return randomBytes(32)}
export function validateTtl(ttl){const value=Number(ttl);if(!Number.isInteger(value)||value<30||value>300)throw new TypeError("ttl_must_be_30_to_300_seconds");return value}
export function explorerUrl(kind,value){if(kind==="signature")return `https://explorer.solana.com/tx/${encodeURIComponent(value)}?cluster=devnet`;if(kind==="address")return `https://explorer.solana.com/address/${encodeURIComponent(value)}?cluster=devnet`;throw new TypeError("unsupported_explorer_kind")}
export function evidenceFor({sessionPda,flags,signature,slot,observedAt=new Date().toISOString()}){const fetchedAt=new Date().toISOString();return{id:`devnet:${signature}:${sessionPda}`,cluster:"devnet",state:"active",freshness:{status:"fresh",ageMs:Math.max(0,Date.parse(fetchedAt)-Date.parse(observedAt))},confidence:"verified",coverage:"complete",value:{paused:Boolean(flags&1),navJump:Boolean(flags&2),authorityChanged:Boolean(flags&4),scenarioFlags:flags},source:{id:"scenario-capsule-monitor",type:"monitoring_backend",programId:PROGRAM_ID,transactionSignature:signature},slot,observedAt,fetchedAt,subject:{type:"account",id:sessionPda}}}
export function signatureFromConfirmationError(error){const match=String(error?.message||error).match(/signature ([1-9A-HJ-NP-Za-km-z]{64,88})\b/);return match?.[1]||null}
export function solscanUrl(kind,value){if(kind==="tx"||kind==="signature")return `https://solscan.io/tx/${encodeURIComponent(value)}?cluster=devnet`;if(kind==="account"||kind==="address")return `https://solscan.io/account/${encodeURIComponent(value)}?cluster=devnet`;throw new TypeError("unsupported_solscan_kind")}
export const KELVARA_TREASURY_PUBKEY="KelvTreasuryDevnet111111111111111111111111111";
export const YIELD_VAULT_INFO=Object.freeze({name:"YieldVault Alpha",pool:"Devnet Leveraged Pool",apy:"21.4%",strategy:"Leveraged Liquidity Provision",coveredCapital:1000,protectionFee:10,protectionFeePercent:1.0});
export function calculateRiskScore(flags){if(flags&4)return{score:100,severity:"CRITICAL",label:"Authority Hijack Detected (Drain Imminent)"};if(flags&2)return{score:95,severity:"CRITICAL",label:"NAV Manipulation / Instant Invariant Break"};if(flags&1)return{score:90,severity:"HIGH",label:"Unauthorized Emergency Pause"};return{score:0,severity:"NONE",label:"Baseline / Operational"}}
