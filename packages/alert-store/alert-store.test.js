import test from "node:test";
import assert from "node:assert/strict";
import { createAlertStore } from "./index.js";

const breach = (overrides={}) => ({
  eventId:"event-1", dedupKey:"program:authority:change", mode:"devnet", level:"devnet",
  cluster:"devnet", subject:{type:"program",id:"Program111"}, ruleId:"authority-rule",
  ruleVersion:1, status:"breach", severity:"high", uncertainty:"single_source",
  evidenceIds:["evidence-1"], recommendedAction:"Review authority change.",
  occurredAt:"2026-09-26T12:00:00.000Z", source:{id:"devnet-monitor",type:"monitoring_backend"}, slot:123,
  ...overrides,
});

test("creates one open alert and deduplicates unchanged breaches",()=>{
 const store=createAlertStore({clock:()=>"2026-09-26T12:00:01.000Z"});
 const first=store.ingest(breach());const second=store.ingest(breach({eventId:"event-2",occurredAt:"2026-09-26T12:00:02.000Z"}));
 assert.equal(first.created,true);assert.equal(second.created,false);assert.equal(store.list().length,1);
 assert.equal(store.list()[0].occurrences,2);assert.equal(store.list()[0].lifecycle,"open");
});

test("keeps paper, fixture simulation, devnet, historical, and live distinct",()=>{
 const store=createAlertStore();
 for(const mode of ["paper","fixture_simulation","devnet","historical","live"])store.ingest(breach({mode,level:mode==="devnet"?"devnet":"paper",dedupKey:"same"}));
 assert.equal(store.list().length,5);
 assert.deepEqual(store.list().map(x=>x.mode).sort(),["devnet","fixture_simulation","historical","live","paper"]);
});

test("acknowledges, resolves, and reopens only on a new breach",()=>{
 const store=createAlertStore({clock:()=>"2026-09-26T12:00:03.000Z"});
 const alert=store.ingest(breach()).alert;
 assert.equal(store.acknowledge(alert.id,"analyst").lifecycle,"acknowledged");
 assert.equal(store.resolve(alert.id,"condition_cleared").lifecycle,"resolved");
 const duplicate=store.ingest(breach({eventId:"event-3"}));
 assert.equal(duplicate.created,true);assert.equal(duplicate.alert.lifecycle,"open");
 assert.equal(store.get(alert.id).lifecycle,"superseded");
});

test("pass result resolves matching open alert without creating green alert",()=>{
 const store=createAlertStore();store.ingest(breach());
 const result=store.ingest(breach({status:"pass",eventId:"clear-1"}));
 assert.equal(result.created,false);assert.equal(result.resolved,true);assert.equal(store.list()[0].lifecycle,"resolved");
});

test("rejects missing provenance and invalid mode",()=>{
 const store=createAlertStore();
 assert.throws(()=>store.ingest(breach({evidenceIds:[]})),/evidenceIds/);
 assert.throws(()=>store.ingest(breach({mode:"unknown-mode"})),/mode/);
 assert.throws(()=>store.ingest(breach({mode:"devnet",source:null})),/source/);
});
