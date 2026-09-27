import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRuleRegistry } from "./index.js";

const rule=(version=1,overrides={})=>({id:"nav-ceiling",version,name:"NAV ceiling",cluster:"devnet",field:"nav",operator:"greater_than",threshold:1.05,nearThresholdPercent:5,severity:"high",recommendedAction:"Review NAV evidence.",...overrides});
async function database(){return join(await mkdtemp(join(tmpdir(),"kelvara-registry-")),"registry.sqlite")}

test("persists immutable rule versions and activation across restart",async()=>{const path=await database();let registry=createRuleRegistry({path});const published=registry.publish(rule(),{actor:"rule-studio"});assert.equal(published.activation,"paused");registry.activate([{id:"nav-ceiling",version:1}],{actor:"analyst"});registry.close();registry=createRuleRegistry({path});assert.equal(registry.list()[0].activation,"active");assert.deepEqual(registry.get("nav-ceiling",1).rule,rule());registry.close()});

test("publishing another version never silently activates it",async()=>{const path=await database();const registry=createRuleRegistry({path});registry.publish(rule());registry.activate([{id:"nav-ceiling",version:1}]);const second=registry.publish(rule(2,{threshold:1.1}));assert.equal(second.activation,"paused");assert.equal(registry.get("nav-ceiling",1).activation,"active");assert.throws(()=>registry.publish(rule(1,{threshold:9})),/immutable_rule_version/);registry.close()});

test("activates and pauses many versions atomically",async()=>{const path=await database();const registry=createRuleRegistry({path});registry.publish(rule());registry.publish(rule(2));registry.publish(rule(1,{id:"supply-floor",name:"Supply floor",field:"supply",operator:"less_than",threshold:100}));registry.activate([{id:"nav-ceiling",version:2},{id:"supply-floor",version:1}],{actor:"llm"});assert.equal(registry.active({cluster:"devnet"}).length,2);registry.pause([{id:"nav-ceiling",version:2},{id:"supply-floor",version:1}],{actor:"llm"});assert.equal(registry.active({cluster:"devnet"}).length,0);registry.close()});

test("activating a new version pauses the older active version",async()=>{const path=await database();const registry=createRuleRegistry({path});registry.publish(rule());registry.publish(rule(2,{threshold:1.1}));registry.activate([{id:"nav-ceiling",version:1}]);registry.activate([{id:"nav-ceiling",version:2}]);assert.equal(registry.get("nav-ceiling",1).activation,"paused");assert.equal(registry.get("nav-ceiling",2).activation,"active");assert.equal(registry.active({cluster:"devnet"}).length,1);registry.close()});

test("records durable audit history",async()=>{const path=await database();const registry=createRuleRegistry({path});registry.publish(rule(),{actor:"author"});registry.activate([{id:"nav-ceiling",version:1}],{actor:"operator"});registry.pause([{id:"nav-ceiling",version:1}],{actor:"operator"});assert.deepEqual(registry.audit().map(x=>x.action),["published","activated","paused"]);registry.close()});
