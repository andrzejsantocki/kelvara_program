import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createRuleStudio } from "./server.js";

async function withServer(fn) {
  const server = createRuleStudio();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try { await fn(`http://127.0.0.1:${server.address().port}`); }
  finally { server.close(); await once(server, "close"); }
}

const rule = { id:"nav-ceiling", version:1, name:"NAV ceiling", field:"nav", operator:"greater_than", threshold:1.05, nearThresholdPercent:5, severity:"high", recommendedAction:"Review valuation evidence." };
const evidence = { id:"evidence:nav:1", cluster:"devnet", state:"active", freshness:{ status:"fresh", ageMs:1000 }, confidence:"verified", coverage:"complete", value:{ nav:1.06 } };

test("serves independent Rule Studio and health endpoint", async () => {
  await withServer(async base => {
    assert.equal((await fetch(`${base}/api/health`)).status, 200);
    const html = await (await fetch(base)).text();
    assert.match(html, /Kelvara Rule Studio/);
    assert.match(html, /Mainnet/);
    assert.match(html, /Devnet/);
  });
});

test("previews deterministic rule result", async () => {
  await withServer(async base => {
    const response = await fetch(`${base}/api/preview`, { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({ rule, evidence, mode:"preview" }) });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.result.status, "breach");
    assert.match(body.summary, /greater than 1.05/);
  });
});

test("blocks mixed rule/evidence networks", async () => {
  await withServer(async base => {
    const response = await fetch(`${base}/api/preview`, { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({ rule:{...rule, cluster:"mainnet-beta"}, evidence, mode:"preview" }) });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, "mixed_clusters");
  });
});

test("accepts real normalized devnet monitoring evidence and exposes level state", async () => {
  await withServer(async base => {
    const monitored = {
      ...evidence,
      source: { id: "indexer-devnet", type: "monitoring_backend" },
      observedAt: "2026-09-26T10:00:00.000Z",
      fetchedAt: "2026-09-26T10:00:01.000Z",
      slot: 123456,
    };
    const response = await fetch(`${base}/api/levels/devnet/evaluate`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ rule: { ...rule, cluster: "devnet" }, evidence: monitored }),
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.level, "devnet");
    assert.equal(result.result.status, "breach");
    assert.equal(result.provenance.slot, 123456);

    const levels = await (await fetch(`${base}/api/levels`)).json();
    assert.equal(levels.devnet.result.status, "breach");
    assert.equal(levels.paper, null);
  });
});

test("devnet level rejects fixture-shaped or stale evidence", async () => {
  await withServer(async base => {
    for (const invalid of [evidence, { ...evidence, state: "stale", source: { id: "backend", type: "monitoring_backend" }, observedAt: "2026-09-26T10:00:00Z", fetchedAt: "2026-09-26T10:00:01Z", slot: 12 }]) {
      const response = await fetch(`${base}/api/levels/devnet/evaluate`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ rule: { ...rule, cluster: "devnet" }, evidence: invalid }),
      });
      if (invalid === evidence) assert.equal(response.status, 400);
      else { assert.equal(response.status, 200); assert.equal((await response.json()).result.status, "unknown"); }
    }
  });
});

test("stores independently published paper and devnet batch runs", async () => {
  await withServer(async base => {
    for (const level of ["paper", "devnet"]) {
      const run = { schemaVersion: 1, runId: `${level}-run`, cluster: "devnet", level, total: 10, counts: { pass: 0, review: 0, breach: 10, unknown: 0 }, samples: [] };
      const response = await fetch(`${base}/api/runs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(run) });
      assert.equal(response.status, 201);
    }
    const levels = await (await fetch(`${base}/api/levels`)).json();
    assert.equal(levels.paper.runId, "paper-run");
    assert.equal(levels.devnet.runId, "devnet-run");
  });
});
