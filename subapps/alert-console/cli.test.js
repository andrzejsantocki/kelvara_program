import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createAlertConsole } from "./server.js";

const exec=promisify(execFile);const cli=fileURLToPath(new URL("./cli.js",import.meta.url));
const event={eventId:"event-cli",dedupKey:"program:authority",mode:"fixture_simulation",level:"paper",cluster:"devnet",subject:{type:"program",id:"Program111"},ruleId:"authority-rule",ruleVersion:1,status:"breach",severity:"high",uncertainty:"simulated",evidenceIds:["fixture-1"],recommendedAction:"Review simulation.",occurredAt:"2026-09-26T12:00:00Z"};
async function run(args){return exec(process.execPath,[cli,...args])}
async function withServer(fn){const server=createAlertConsole();server.listen(0,"127.0.0.1");await once(server,"listening");try{await fn(`http://127.0.0.1:${server.address().port}`)}finally{server.close();await once(server,"close")}}

test("CLI manually activates and clears fixture alerts",async()=>withServer(async base=>{const activated=JSON.parse((await run(["simulate","pause","--api",base])).stdout);assert.equal(activated.alert.mode,"fixture_simulation");let listed=JSON.parse((await run(["list","--api",base,"--mode","fixture_simulation"])).stdout);assert.equal(listed.length,1);const cleared=JSON.parse((await run(["clear-fixtures","--api",base])).stdout);assert.equal(cleared.cleared,1);listed=JSON.parse((await run(["list","--api",base])).stdout);assert.deepEqual(listed,[])}));

test("CLI ingests JSON or NDJSON and reads filtered alerts",async()=>withServer(async base=>{const dir=await mkdtemp(join(tmpdir(),"alert-cli-"));const file=join(dir,"events.ndjson");await writeFile(file,[event,{...event,eventId:"event-cli-2"}].map(JSON.stringify).join("\n"));const ingest=JSON.parse((await run(["ingest",file,"--api",base])).stdout);assert.deepEqual(ingest,{accepted:2,created:1,deduplicated:1});const listed=JSON.parse((await run(["list","--api",base,"--mode","fixture_simulation"])).stdout);assert.equal(listed.length,1);assert.equal(listed[0].occurrences,2)}));

test("CLI acknowledges and resolves an alert",async()=>withServer(async base=>{const dir=await mkdtemp(join(tmpdir(),"alert-life-"));const file=join(dir,"event.json");await writeFile(file,JSON.stringify(event));await run(["ingest",file,"--api",base]);const alert=JSON.parse((await run(["list","--api",base])).stdout)[0];assert.equal(JSON.parse((await run(["acknowledge",alert.id,"--api",base,"--actor","llm"])).stdout).lifecycle,"acknowledged");assert.equal(JSON.parse((await run(["resolve",alert.id,"--api",base,"--resolution","tested"])).stdout).lifecycle,"resolved")}));

test("CLI publishes, activates, lists, pauses rules, and submits evidence",async()=>withServer(async base=>{const dir=await mkdtemp(join(tmpdir(),"rules-cli-"));const ruleFile=join(dir,"rules.json");const evidenceFile=join(dir,"evidence.json");const rule={id:"nav",version:1,name:"NAV",cluster:"devnet",field:"nav",operator:"greater_than",threshold:1.05,severity:"high",recommendedAction:"Review."};await writeFile(ruleFile,JSON.stringify([rule]));await writeFile(evidenceFile,JSON.stringify({id:"e1",cluster:"devnet",state:"active",freshness:{status:"fresh",ageMs:1},confidence:"verified",coverage:"complete",value:{nav:1.1},source:{id:"monitor",type:"monitoring_backend"},slot:2,observedAt:"2026-09-26T12:00:00Z",fetchedAt:"2026-09-26T12:00:01Z",subject:{type:"program",id:"Program111"}}));const published=JSON.parse((await run(["publish-rules",ruleFile,"--api",base,"--actor","studio"])).stdout);assert.equal(published[0].activation,"paused");const refs=join(dir,"refs.json");await writeFile(refs,JSON.stringify([{id:"nav",version:1}]));assert.equal(JSON.parse((await run(["activate-rules",refs,"--api",base])).stdout)[0].activation,"active");assert.equal(JSON.parse((await run(["list-rules","--api",base,"--activation","active"])).stdout).length,1);assert.equal(JSON.parse((await run(["monitor",evidenceFile,"--api",base])).stdout)[0].result.status,"breach");assert.equal(JSON.parse((await run(["pause-rules",refs,"--api",base])).stdout)[0].activation,"paused")}));
