import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveKaminoRuntimeConfig, loadOrCreateProtectionKey } from "../subapps/kamino-monitor/runtime-config.js";

test("HAOS runtime binds externally and stores protection state under /data", () => {
  const config = resolveKaminoRuntimeConfig({
    HOST: "0.0.0.0",
    PORT: "7650",
    KELVARA_RUNTIME_DIR: "/data/kamino-monitor",
  });
  assert.equal(config.host, "0.0.0.0");
  assert.equal(config.port, 7650);
  assert.equal(config.keyPath, "/data/kamino-monitor/protection.key");
  assert.equal(config.storePath, "/data/kamino-monitor/armed-protection.enc");
});

test("local runtime keeps loopback and repository-local state defaults", () => {
  const config = resolveKaminoRuntimeConfig({}, "/opt/kelvara/subapps/kamino-monitor");
  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.port, 8080);
  assert.equal(config.runtimeDir, "/opt/kelvara/.runtime/kamino-monitor");
});

test("invalid bind ports are rejected", () => {
  assert.throws(() => resolveKaminoRuntimeConfig({ PORT: "0" }), /PORT/);
  assert.throws(() => resolveKaminoRuntimeConfig({ PORT: "not-a-port" }), /PORT/);
});

test("protection key is created once with restrictive permissions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kelvara-key-"));
  try {
    const keyPath = join(dir, "protection.key");
    const storePath = join(dir, "armed-protection.enc");
    const key = await loadOrCreateProtectionKey({ keyPath, storePath });
    assert.equal(key.length, 32);
    assert.equal((await readFile(keyPath, "utf8")).trim(), key.toString("base64"));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("existing encrypted state without its key fails closed", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kelvara-key-"));
  try {
    const keyPath = join(dir, "protection.key");
    const storePath = join(dir, "armed-protection.enc");
    await writeFile(storePath, "ciphertext");
    await assert.rejects(loadOrCreateProtectionKey({ keyPath, storePath }), /protection_key_missing_for_existing_store/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("corrupt protection key fails closed", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kelvara-key-"));
  try {
    const keyPath = join(dir, "protection.key");
    const storePath = join(dir, "armed-protection.enc");
    await writeFile(keyPath, "not-base64", { mode: 0o600 });
    await assert.rejects(loadOrCreateProtectionKey({ keyPath, storePath }), /protection_key_invalid/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
