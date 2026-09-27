import { resolve } from "node:path";
import { createIngestionRunner } from "./runner.js";
import { runIndexerStep } from "./process.js";
import { inspectIndexer } from "./inspect.js";
import { createJsonStatusStore } from "./status-store.js";

const indexerDir = resolve(process.env.KELVARA_INDEXER_DIR || "/home/andy/kelvara-build/[codebase]/indexer_anchor_protocol");
const dbPath = resolve(process.env.KELVARA_INDEXER_DB_PATH || `${indexerDir}/indexer.db`);
const statusPath = resolve(process.env.KELVARA_INGESTION_STATUS_PATH || "./var/ingestion-status.json");
const intervalMs = Number(process.env.KELVARA_INGESTION_INTERVAL_MS || 15_000);
const timeoutMs = Number(process.env.KELVARA_INDEXER_STEP_TIMEOUT_MS || 120_000);
const processLimit = Number(process.env.KELVARA_PROCESS_LIMIT || 25);
const once = process.argv.includes("--once");
const store = createJsonStatusStore(statusPath);
const runner = createIngestionRunner({
  runStep: step => runIndexerStep(step, { indexerDir, timeoutMs, processLimit }),
  inspectSource: () => inspectIndexer(dbPath, { maxAgeSeconds: Math.ceil(intervalMs / 1000) * 3 }),
  writeStatus: status => store.write(status),
});

async function cycle() {
  const result = await runner.runOnce();
  console.log(JSON.stringify({ type: "ingestion-cycle", result }));
  return result;
}

const result = await cycle();
if (once) process.exit(result.ok ? 0 : 1);
setInterval(cycle, intervalMs);
