import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createContractInspector } from "./server.js";

async function withServer(fn) {
  const server = createContractInspector();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

test("serves a simple white contract inspector", async () => {
  await withServer(async base => {
    const response = await fetch(base);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /Kelvara Contract Inspector/);
    assert.match(html, /Mainnet/);
    assert.match(html, /Devnet/);
  });
});

test("validates evidence through the HTTP API", async () => {
  await withServer(async base => {
    const response = await fetch(`${base}/api/validate/evidence`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cluster: "testnet" }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.valid, false);
    assert.match(body.errors.join(" "), /cluster/);
  });
});

test("returns the selected network profile without exposing RPC credentials", async () => {
  await withServer(async base => {
    const response = await fetch(`${base}/api/network?cluster=devnet`);
    const body = await response.json();
    assert.equal(body.cluster, "devnet");
    assert.deepEqual(body.rpcProviders, ["https://api.devnet.solana.com"]);
  });
});
