import test from "node:test";
import assert from "node:assert/strict";
import { evaluateBatch } from "./batch.js";

const rule = index => ({ id:`rule-${index}`, version:1, name:`Rule ${index}`, cluster:"devnet", field:"value", operator:"greater_than", threshold:100, nearThresholdPercent:5, severity:"high", recommendedAction:"Review." });
const evidence = (index, value=101) => ({ id:`evidence-${index}`, cluster:"devnet", state:"active", freshness:{status:"fresh",ageMs:0}, confidence:"verified", coverage:"complete", value:{value} });

test("evaluates thousands of cases with deterministic summary", () => {
  const cases = Array.from({length:5000}, (_,index)=>({rule:rule(index), evidence:evidence(index,index%2?101:50)}));
  const first=evaluateBatch(cases,{cluster:"devnet",runId:"scale-run"});
  const second=evaluateBatch(cases,{cluster:"devnet",runId:"scale-run"});
  assert.equal(first.total,5000);
  assert.deepEqual(first.counts,{pass:2500,review:0,breach:2500,unknown:0});
  assert.deepEqual(first,second);
  assert.equal(first.results.length,5000);
});

test("rejects mixed batch clusters",()=>{
  assert.throws(()=>evaluateBatch([
    {rule:rule(1),evidence:evidence(1)},
    {rule:{...rule(2),cluster:"mainnet-beta"},evidence:{...evidence(2),cluster:"mainnet-beta"}},
  ],{cluster:"devnet"}),/mixed_clusters/);
});

test("limits samples while preserving complete counts",()=>{
  const result=evaluateBatch(Array.from({length:20},(_,index)=>({rule:rule(index),evidence:evidence(index)})),{cluster:"devnet",sampleLimit:3});
  assert.equal(result.counts.breach,20);
  assert.equal(result.samples.length,3);
});
