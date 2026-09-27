import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRuleRegistry } from "./index.js";
import { createMonitor } from "./monitor.js";
import { createAlertStore } from "../alert-store/index.js";

const rule={id:"nav-ceiling",version:1,name:"NAV ceiling",cluster:"devnet",field:"nav",operator:"greater_than",threshold:1.05,nearThresholdPercent:5,severity:"high",recommendedAction:"Review NAV."};
const evidence=value=>({id:`evidence-${value}`,cluster:"devnet",state:"active",freshness:{status:"fresh",ageMs:100},confidence:"verified",coverage:"complete",value:{nav:value},source:{id:"monitor",type:"monitoring_backend"},slot:123,observedAt:"2026-09-26T12:00:00Z",fetchedAt:"2026-09-26T12:00:01Z",subject:{type:"program",id:"Program111"}});
async function setup(){const path=join(await mkdtemp(join(tmpdir(),"monitor-")),"rules.sqlite");const registry=createRuleRegistry({path});registry.publish(rule);registry.activate([{id:rule.id,version:1}]);const alerts=createAlertStore();return{registry,alerts,monitor:createMonitor({registry,alerts})}}

test("evaluates all matching active rules and creates evidence-linked alerts",async()=>{const {registry,alerts,monitor}=await setup();const results=monitor.evaluate(evidence(1.06));assert.equal(results.length,1);assert.equal(results[0].result.status,"breach");const alert=alerts.list()[0];assert.equal(alert.ruleId,"nav-ceiling");assert.deepEqual(alert.evidenceIds,["evidence-1.06"]);assert.equal(alert.slot,123);registry.close()});

test("paused rules do not evaluate and pass resolves prior alert",async()=>{const {registry,alerts,monitor}=await setup();monitor.evaluate(evidence(1.06));monitor.evaluate(evidence(0.9));assert.equal(alerts.list()[0].lifecycle,"resolved");registry.pause([{id:rule.id,version:1}]);assert.deepEqual(monitor.evaluate(evidence(1.2)),[]);registry.close()});

test("rejects unmonitored or mismatched evidence",async()=>{const {registry,monitor}=await setup();assert.throws(()=>monitor.evaluate({...evidence(1.1),source:{id:"fixture",type:"fixture_rpc"}}),/monitoring_backend/);assert.throws(()=>monitor.evaluate({...evidence(1.1),cluster:"mainnet-beta"}),/devnet/);registry.close()});
