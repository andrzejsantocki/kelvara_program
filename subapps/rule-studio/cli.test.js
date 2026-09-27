import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec=promisify(execFile);
const cli=fileURLToPath(new URL("./cli.js",import.meta.url));
const rule={id:"limit",version:1,name:"Limit",cluster:"devnet",field:"value",operator:"greater_than",threshold:10,nearThresholdPercent:0,severity:"high",recommendedAction:"Review."};
const evidence={id:"ev",cluster:"devnet",state:"active",freshness:{status:"fresh",ageMs:0},confidence:"verified",coverage:"complete",value:{value:11}};

async function run(args){return exec(process.execPath,[cli,...args],{maxBuffer:10*1024*1024});}

test("validates a declarative rule from JSON file",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"kelvara-rule-"));const file=join(dir,"rule.json");await writeFile(file,JSON.stringify(rule));
 const {stdout}=await run(["validate",file]);assert.deepEqual(JSON.parse(stdout),{valid:true,errors:[]});
});

test("runs JSON batch and emits machine-readable summary",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"kelvara-batch-"));const file=join(dir,"batch.json");await writeFile(file,JSON.stringify([{rule,evidence},{rule:{...rule,id:"safe"},evidence:{...evidence,id:"safe-ev",value:{value:1}}}]));
 const {stdout}=await run(["run-batch",file,"--cluster","devnet","--summary-only"]);const body=JSON.parse(stdout);
 assert.equal(body.total,2);assert.deepEqual(body.counts,{pass:1,review:0,breach:1,unknown:0});assert.equal("results" in body,false);
});

test("runs NDJSON and deterministic breach simulation at scale",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"kelvara-ndjson-"));const file=join(dir,"batch.ndjson");await writeFile(file,[{rule,evidence},{rule:{...rule,id:"second"},evidence:{...evidence,id:"second-ev"}}].map(JSON.stringify).join("\n"));
 assert.equal(JSON.parse((await run(["run-batch",file,"--cluster","devnet"])).stdout).counts.breach,2);
 const simulation=JSON.parse((await run(["simulate-breach","--count","3000","--cluster","devnet","--summary-only"])).stdout);
 assert.equal(simulation.total,3000);assert.equal(simulation.counts.breach,3000);assert.equal(simulation.mode,"breach_simulation");
});

test("runs paper and real devnet levels together",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"kelvara-levels-"));
 const paper=join(dir,"paper.json");const devnet=join(dir,"devnet.json");
 await writeFile(paper,JSON.stringify([{rule,evidence}]));
 await writeFile(devnet,JSON.stringify([{rule,evidence:{...evidence,source:{id:"devnet-monitor",type:"monitoring_backend"},slot:999,observedAt:"2026-09-26T10:00:00Z",fetchedAt:"2026-09-26T10:00:01Z"}}]));
 const result=JSON.parse((await run(["run-levels","--paper",paper,"--devnet",devnet,"--summary-only"])).stdout);
 assert.equal(result.paper.level,"paper");assert.equal(result.devnet.level,"devnet");
 assert.equal(result.paper.counts.breach,1);assert.equal(result.devnet.counts.breach,1);
});

test("devnet CLI refuses fixture evidence without monitoring provenance",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"kelvara-devnet-"));const file=join(dir,"devnet.json");await writeFile(file,JSON.stringify([{rule,evidence}]));
 await assert.rejects(()=>run(["run-levels","--devnet",file]),error=>/invalid_devnet_evidence/.test(error.stderr));
});

test("publishes authored rules to Alert Console without activating them",async()=>{
 const requests=[];const server=(await import("node:http")).createServer(async(req,res)=>{let text="";for await(const chunk of req)text+=chunk;requests.push({url:req.url,body:JSON.parse(text)});res.writeHead(201,{"content-type":"application/json"});res.end(JSON.stringify({id:req.url,activation:"paused"}))});server.listen(0,"127.0.0.1");await new Promise(resolve=>server.once("listening",resolve));try{const dir=await mkdtemp(join(tmpdir(),"kelvara-publish-"));const file=join(dir,"rules.json");await writeFile(file,JSON.stringify([rule,{...rule,id:"second"}]));const result=JSON.parse((await run(["publish-rules",file,"--alert-console",`http://127.0.0.1:${server.address().port}`,"--actor","rule-studio"])).stdout);assert.equal(result.length,2);assert.equal(result.every(item=>item.activation==="paused"),true);assert.equal(requests.every(item=>item.url==="/api/rules"&&item.body.actor==="rule-studio"),true)}finally{server.close();await new Promise(resolve=>server.once("close",resolve))}
});
