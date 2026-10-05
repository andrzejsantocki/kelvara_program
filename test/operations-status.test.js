import test from "node:test";
import assert from "node:assert/strict";
import { createOperationsService } from "../src/domains/operations/status.js";

function store({ telemetry = [], targets = [], incidents = [], coverage = null } = {}) {
  return { listTelemetry: () => telemetry, listTargets: () => targets, listIncidents: () => incidents, ...(coverage ? { getCoverage: () => coverage } : {}) };
}

test("operations status returns unknown nulls instead of fabricated zero metrics", () => {
  const service = createOperationsService({ store: store(), readIngestionStatus: () => ({ state: "never-run", lastResult: null }), diskStats: () => ({ totalBytes: 100, freeBytes: 90, dbBytes: 10, telemetryGrowthBytesPerSecond: null }), startedAt: 100, now: () => 120 });
  const status = service.getStatus();
  assert.equal(status.service.state, "never-run");
  assert.equal(status.kpis.providerLatencyMs, null);
  assert.equal(status.kpis.sourceLagMs, null);
  assert.equal(status.kpis.processingLagMs, null);
  assert.equal(status.kpis.backlog, null);
  assert.equal(status.kpis.observationSuccessRatio, null);
  assert.equal(Object.hasOwn(status.kpis, "uptimeRatio"), false);
  assert.equal(status.providers.state, "unknown");
  assert.equal(status.service.uptimeSeconds, 20);
});

test("provider current state uses the latest sample after recovery", () => {
  const telemetry = [
    { sampledAt: 10, provider: "rpc-a", success: false },
    { sampledAt: 20, provider: "rpc-a", success: true },
  ];
  const service = createOperationsService({ store: store({ telemetry }), readIngestionStatus: () => ({ state: "idle" }), diskStats: () => ({ totalBytes: 100, freeBytes: 90, dbBytes: 10 }) });

  assert.equal(service.getStatus().providers.state, "available");
});

test("provider current state reflects every provider's latest sample", () => {
  const telemetry = [
    { sampledAt: 10, provider: "rpc-a", success: false },
    { sampledAt: 20, provider: "rpc-a", success: true },
    { sampledAt: 30, provider: "rpc-b", success: true },
  ];
  const service = createOperationsService({ store: store({ telemetry }), readIngestionStatus: () => ({ state: "idle" }), diskStats: () => ({ totalBytes: 100, freeBytes: 90, dbBytes: 10 }) });
  const providers = service.getStatus().providers;

  assert.equal(providers.state, "available");
  assert.equal(providers.providerCount, 2);
  assert.deepEqual(providers.recentWindow, { sampleCount: 3, successRatio: 2 / 3 });
});

test("operations status reads the persisted retention outcome", () => {
  const persisted = { state: "ok", lastSuccessfulCompactionAt: 115, compactionLagSeconds: 5 };
  const service = createOperationsService({ store: store(), readIngestionStatus: () => ({ state: "idle" }), diskStats: () => ({ totalBytes: 100, freeBytes: 90, dbBytes: 10 }), retention: () => persisted });

  assert.deepEqual(service.getStatus().retention, persisted);
});

test("operations target coverage reports monitored wallets rather than generic positions", () => {
  const targets = Array.from({ length: 15 }, (_, index) => ({ id: `target-${index}`, protocol: `p${index % 5}`, walletCount: 20 }));
  const service = createOperationsService({ store: store({ targets, coverage: { walletTargetLinks: 300, distinctWallets: 100 } }), readIngestionStatus: () => ({ state: "idle" }), diskStats: () => ({ totalBytes: 100, freeBytes: 90, dbBytes: 10 }), startedAt: 0, now: () => 1 });
  assert.equal(service.getTargets().targets.length, 15);
  assert.deepEqual(service.getTargets().coverage, { uniqueTargets: 15, walletTargetLinks: 300, distinctWallets: 100 });
});


test("operations target coverage fallback remains explicit when wallet coverage is unavailable", () => {
  const targets = [{ id: "target-1", protocol: "p1", walletCount: 2 }];
  const service = createOperationsService({ store: store({ targets }), readIngestionStatus: () => ({ state: "idle" }), diskStats: () => ({ totalBytes: 100, freeBytes: 90, dbBytes: 10 }), startedAt: 0, now: () => 1 });
  assert.deepEqual(service.getTargets().coverage, { uniqueTargets: 1, walletTargetLinks: 2, distinctWallets: null });
});
