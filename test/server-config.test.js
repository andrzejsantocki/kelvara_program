import test from "node:test";
import assert from "node:assert/strict";
import { resolveServerConfig } from "../src/platform/http/config.js";

test("loopback development may omit operations token", () => {
  const config = resolveServerConfig({ HOST: "127.0.0.1", PORT: "7610" });
  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.operationsToken, null);
});

test("non-loopback bind requires operations token", () => {
  assert.throws(
    () => resolveServerConfig({ HOST: "0.0.0.0", PORT: "7610" }),
    /KELVARA_OPERATIONS_TOKEN is required/,
  );
  const config = resolveServerConfig({ HOST: "0.0.0.0", PORT: "7610", KELVARA_OPERATIONS_TOKEN: "secret" });
  assert.equal(config.operationsToken, "secret");
});

test("invalid port and retention-independent paths are rejected or resolved", () => {
  assert.throws(() => resolveServerConfig({ HOST: "127.0.0.1", PORT: "nope" }), /PORT/);
  const config = resolveServerConfig({ HOST: "127.0.0.1", KELVARA_DB_PATH: "/data/kelvara.sqlite", KELVARA_INGESTION_STATUS_PATH: "/data/ingestion.json" });
  assert.equal(config.consumerDbPath, "/data/kelvara.sqlite");
  assert.equal(config.statusPath, "/data/ingestion.json");
  assert.equal(config.maintenanceStatusPath.endsWith("var/maintenance-status.json"), true);
});

test("maintenance status path may live under HAOS data", () => {
  const config = resolveServerConfig({ HOST: "127.0.0.1", KELVARA_MAINTENANCE_STATUS_PATH: "/data/maintenance.json" });
  assert.equal(config.maintenanceStatusPath, "/data/maintenance.json");
});
