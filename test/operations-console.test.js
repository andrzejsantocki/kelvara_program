import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../subapps/operations-console/", import.meta.url);

async function source(name) { return readFile(new URL(name, root), "utf8"); }

test("operations console presents source, ingestion, storage, provider, retention, incident and target evidence", async () => {
  const html = await source("index.html");
  for (const id of [
    "service-state", "service-uptime", "source-freshness", "source-lag", "processing-lag",
    "source-head", "source-signatures", "source-processed", "source-pending", "source-failed",
    "source-instructions", "source-accounts", "provider-state", "provider-latency", "provider-success",
    "storage-action", "storage-used", "storage-db-size", "retention-state", "compaction-lag",
    "coverage-targets", "coverage-positions", "coverage-links", "incident-list", "target-table-body",
  ]) assert.match(html, new RegExp(`id="${id}"`), id);
  assert.match(html, /READ-ONLY OPERATIONS/);
  assert.match(html, /Unknown means not measured/);
  assert.doesNotMatch(html, /<script[^>]+src=["']https?:/);
});

test("operations console fetches wrapper APIs and keeps token in memory only", async () => {
  const app = await source("app.js");
  for (const endpoint of ["/api/health", "/api/sources/onre-indexer", "/api/operations/status", "/api/operations/targets"]) {
    assert.match(app, new RegExp(endpoint.replaceAll("/", "\\/")));
  }
  assert.match(app, /Authorization/);
  assert.match(app, /Bearer/);
  assert.match(app, /Promise\.allSettled/);
  assert.match(app, /setInterval/);
  assert.doesNotMatch(app, /localStorage|sessionStorage|indexedDB|document\.cookie/);
  assert.doesNotMatch(app, /sqlite|SELECT\s|INSERT\s|UPDATE\s|DELETE\s/i);
});

test("operations console names control-plane responsibilities and exposes drill-down views", async () => {
  const html = await source("index.html");
  for (const label of ["Invariant monitoring", "Protocol indexers", "Provider observations", "Storage and retention", "Clients"]) assert.match(html, new RegExp(label));
  for (const id of ["indexer-list", "continuity-chart", "provider-list", "quota-gb", "save-quota", "client-table-body", "client-detail"]) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /aria-label="Hourly monitoring continuity"/);
  assert.match(html, /Distinct wallets/);
  assert.match(html, /Wallet-target links/);
  const app = await source("app.js");
  assert.match(app, /distinctWallets/);
  assert.match(app, /walletTargetLinks/);
  assert.match(app, /walletCount/);
  assert.doesNotMatch(app, /distinctPositions|targetLinks|positionCount/);
});

test("operations console separates read-only monitoring from mutable admin", async () => {
  const html = await source("index.html");
  assert.match(html, /<nav class="primary-nav" aria-label="Primary navigation">[\s\S]*id="monitoring-tab"[\s\S]*id="admin-tab"[\s\S]*<\/nav>/);
  assert.match(html, /id="monitoring-shell"/);
  assert.match(html, /id="admin-shell"/);
  const monitoring = html.slice(html.indexOf('id="monitoring-shell"'), html.indexOf('id="admin-shell"'));
  assert.doesNotMatch(monitoring, /id="operations-token"|id="save-quota"|type="number"/);
  const admin = html.slice(html.indexOf('id="admin-shell"'));
  assert.match(admin, /id="operations-token"/);
  assert.match(admin, /id="save-quota"/);
});

test("monitoring uses grouped left navigation and focused deep-dive panes", async () => {
  const html = await source("index.html");
  for (const group of ["Command", "Operations", "Customers", "Evidence"]) assert.match(html, new RegExp(`>${group}<`));
  for (const pane of ["overview", "incidents", "indexers", "providers", "targets", "clients", "continuity", "storage"]) {
    assert.match(html, new RegExp(`data-pane="${pane}"`));
    assert.match(html, new RegExp(`data-view="${pane}"`));
  }
  const app = await source("app.js");
  assert.match(app, /showPane/);
  assert.match(app, /data-pane/);
});

test("main summary contains global operational data, not ONRE custom freshness", async () => {
  const html = await source("index.html");
  const summary = html.match(/<section class="summary-strip"[\s\S]*?<\/section>/)?.[0] || "";
  assert.match(summary, /Invariant monitoring/);
  assert.match(summary, /Provider observations/);
  assert.match(summary, /Open incidents/);
  assert.doesNotMatch(summary, /ONRE|source-freshness|source-head/);
  assert.match(html, /data-view="indexers"[\s\S]*id="source-freshness"[\s\S]*id="source-head"/);
});

test("operations console provides a SQL-backed clients deep dive", async () => {
  const html = await source("index.html");
  const app = await source("app.js");
  for (const id of ["client-table-body", "client-detail"]) assert.match(html, new RegExp(`id="${id}"`));
  for (const label of ["Clients", "Last activity", "Paid amount", "Signed evacuation transactions"]) assert.match(html, new RegExp(label));
  assert.match(app, /\/api\/operations\/clients/);
  assert.doesNotMatch(app, /\/api\/operations\/wallets/);
});

test("operations console loads indexer, history, settings, and client APIs", async () => {
  const app = await source("app.js");
  for (const endpoint of ["/api/operations/indexers", "/api/operations/history", "/api/operations/settings", "/api/operations/clients"]) assert.match(app, new RegExp(endpoint.replaceAll("/", "\\/")));
  assert.match(app, /gap/); assert.match(app, /adverse/); assert.match(app, /healthy/);
});

test("operations console is responsive without horizontal data-table overflow", async () => {
  const css = await source("styles.css");
  assert.match(css, /grid-template-columns:repeat\(auto-fit,minmax\(min\(100%,220px\),1fr\)\)/);
  assert.match(css, /overflow-wrap:anywhere/);
  assert.match(css, /@media\(max-width:720px\)/);
  assert.doesNotMatch(css, /min-width:\s*[7-9]\d\dpx|min-width:\s*\d{4,}px/);
});
