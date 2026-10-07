import test from "node:test";
import assert from "node:assert/strict";
import { createApiClient } from "../subapps/kamino-monitor/web/evacuation-client.js";
import { KAMINO_METRICS_MAX_RESPONSE_BYTES, KAMINO_POSITIONS_MAX_RESPONSE_BYTES, KAMINO_WITHDRAW_MAX_RESPONSE_BYTES } from "../subapps/kamino-monitor/server.js";

function stream(chunks, delay=0){return new ReadableStream({async start(controller){for(const chunk of chunks){if(delay)await new Promise(resolve=>setTimeout(resolve,delay));controller.enqueue(new TextEncoder().encode(chunk))}controller.close()}})}
function response(value,{status=200,length,body=stream([JSON.stringify(value)])}={}){const headers=new Headers();if(length!==undefined)headers.set("content-length",String(length));return {ok:status>=200&&status<300,status,headers,body}}

test("Kamino caps are explicit and endpoint-scoped",()=>{assert.equal(KAMINO_WITHDRAW_MAX_RESPONSE_BYTES,256*1024);assert.equal(KAMINO_POSITIONS_MAX_RESPONSE_BYTES,128*1024);assert.equal(KAMINO_METRICS_MAX_RESPONSE_BYTES,32*1024)});

test("embedded evacuation client rejects declared, streamed, malformed, bodyless, and delayed responses",async()=>{
 const cases=[
  ["declared",async()=>response({}, {length:128*1024+1}),"response_too_large"],
  ["streamed",async()=>response({}, {body:stream(["x".repeat(128*1024+1)])}),"response_too_large"],
  ["malformed",async()=>response({}, {body:stream(["{"]) }),"response_malformed_json"],
  ["bodyless",async()=>response({}, {body:null}),"response_body_unavailable"],
  ["delayed",async()=>response({}, {body:stream(["{}"],6000)}),"request_timeout"]
 ];
 for(const [,fetchImpl,expected] of cases){const client=createApiClient({network:"mainnet-beta",fetchImpl,timeoutMs:40});await assert.rejects(()=>client.request("/api/evacuation/status"),error=>error.code===expected)}
});

test("embedded evacuation client rejects non-2xx with bounded structured error",async()=>{const client=createApiClient({network:"mainnet-beta",fetchImpl:async()=>response({error:"rejected"},{status:413})});await assert.rejects(()=>client.post("/api/evacuation/submit"),error=>error.code==="rejected"&&error.status===413)});

test("published protection request uses the bounded reader",async()=>{
 const { readFile }=await import("node:fs/promises");
 const source=await readFile("subapps/kamino-monitor/web/app.js","utf8");
 assert.equal(source.includes("response.json(") || source.includes("response.text("),false);
 assert.match(source,/evacuationApi\.request\(path/);
});

test("external JSON clients bound stalled fetch and body reads",async()=>{
 const { createControlPlaneClient }=await import("../subapps/kamino-monitor/portfolio-orchestrator.js");
 const stalled=()=>new Promise(()=>{});
 const started=Date.now();
 await assert.rejects(()=>createControlPlaneClient({url:"http://control",token:"x".repeat(32),fetchImpl:stalled,timeoutMs:40}).readManifest(),/control_plane_timeout/);
 assert.ok(Date.now()-started<250);
 const delayedBody=async()=>({ok:true,body:{[Symbol.asyncIterator]:async function*(){await new Promise(resolve=>setTimeout(resolve,250));yield Buffer.from("{}");}}});
 const bodyStarted=Date.now();
 await assert.rejects(()=>createControlPlaneClient({url:"http://control",token:"x".repeat(32),fetchImpl:delayedBody,timeoutMs:40}).readManifest(),/control_plane_timeout/);
 assert.ok(Date.now()-bodyStarted<250);
});

test("production Kamino code has no response JSON/text fallbacks",async()=>{
 const { readFile }=await import("node:fs/promises");
 for(const file of ["subapps/kamino-monitor/web/app.js","subapps/kamino-monitor/portfolio-orchestrator.js"]) assert.doesNotMatch(await readFile(file,"utf8"),/response\\.(json|text)\(/);
});
