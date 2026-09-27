import test from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import { ANIMAL_IDENTICON_VERSION, animalIdenticonTraits, animalIdenticonSvg } from "../subapps/kamino-monitor/web/animal-identicon.js";

const KEYS=[
 "11111111111111111111111111111111",
 "So11111111111111111111111111111111111111112",
 "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
 "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
 "ComputeBudget111111111111111111111111111111",
 "SysvarRent111111111111111111111111111111111",
 "Vote111111111111111111111111111111111111111",
 "Stake11111111111111111111111111111111111111",
 "BPFLoaderUpgradeab1e11111111111111111111111",
 "AddressLookupTab1e1111111111111111111111111"
];

test("animal traits are deterministic, versioned, and varied",()=>{
 assert.equal(ANIMAL_IDENTICON_VERSION,1);
 const first=animalIdenticonTraits(KEYS[0]);
 assert.deepEqual(animalIdenticonTraits(KEYS[0]),first);
 assert.deepEqual(first,{version:1,animal:"fox",palette:"moss",background:"halo",accent:"brow",mirror:false});
 const signatures=new Set(KEYS.map(key=>JSON.stringify(animalIdenticonTraits(key))));
 assert.ok(signatures.size>=8,`expected at least 8 distinct trait combinations, got ${signatures.size}`);
});

test("animal traits reject values that are not plausible Solana public keys",()=>{
 for(const value of [null,undefined,"","  ","not-a-wallet","0OIl1111111111111111111111111111","zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz",123])assert.equal(animalIdenticonTraits(value),null);
});

test("animal SVG is deterministic, self-contained, and never embeds the key",()=>{
 const key=KEYS[1],svg=animalIdenticonSvg(key);
 assert.equal(svg,animalIdenticonSvg(key));
 assert.match(svg,/^<svg /);
 assert.match(svg,/viewBox="0 0 64 64"/);
 assert.match(svg,/aria-hidden="true"/);
 assert.match(svg,/data-animal="[a-z]+"/);
 assert.doesNotMatch(svg,new RegExp(key));
 assert.doesNotMatch(svg,/<script|foreignObject|\son[a-z]+=|(?:href|src)=["']https?:|url\(/i);
 assert.ok(svg.length<6000,`SVG exceeds size budget: ${svg.length}`);
});

test("every curated animal renderer is reachable and safe",()=>{
 const seen=new Set();
 for(let index=0;index<5000&&seen.size<12;index++){
  const key=Keypair.generate().publicKey.toString();
  const traits=animalIdenticonTraits(key);
  if(!traits)continue;
  const svg=animalIdenticonSvg(key);
  seen.add(traits.animal);
  assert.match(svg,new RegExp(`data-animal="${traits.animal}"`));
 }
 assert.equal(seen.size,12);
});

test("invalid keys do not receive an invented identity",()=>{
 assert.equal(animalIdenticonSvg(""),null);
 assert.equal(animalIdenticonSvg("not-a-wallet"),null);
});
