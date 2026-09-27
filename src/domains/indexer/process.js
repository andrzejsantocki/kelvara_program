import { spawn } from "node:child_process";
import { join } from "node:path";

const STEP_ARGS = Object.freeze({
  recent: ["src/index.ts", "--recent"],
  process: ["src/index.ts", "--process", "--all"],
  accounts: ["src/index.ts", "--accounts"],
});

export function commandForStep(step, { processLimit = 25 } = {}) {
  const args = STEP_ARGS[step];
  if (!args) throw new Error(`unsupported indexer step: ${step}`);
  if (step === "process") return [...args, "--limit", String(processLimit)];
  return [...args];
}

export function compactOutput(output, limit = 4000) {
  const text = String(output || "");
  return text.length <= limit ? text : `…${text.slice(-limit)}`;
}

export function runIndexerStep(step, {
  indexerDir,
  timeoutMs = 120_000,
  processLimit = 25,
  spawnImpl = spawn,
  killImpl = process.kill,
} = {}) {
  const executable = join(indexerDir, "node_modules", ".bin", "tsx");
  const args = commandForStep(step, { processLimit });
  return new Promise(resolve => {
    const child = spawnImpl(executable, args, {
      cwd: indexerDir,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    let output = "";
    let timedOut = false;
    let settled = false;
    child.stdout.on("data", chunk => { output += chunk; });
    child.stderr.on("data", chunk => { output += chunk; });
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      output += `\ntimed out after ${timeoutMs}ms`;
      try { killImpl(-child.pid, "SIGTERM"); } catch (error) { output += `\ntermination failed: ${error.message}`; }
    }, timeoutMs);
    child.on("error", error => finish({ code: -1, timedOut, output: compactOutput(output + error.message) }));
    child.on("close", (code, signal) => {
      const suffix = signal ? `\nterminated by ${signal}` : "";
      finish({ code: code ?? -1, timedOut, output: compactOutput(output + suffix) });
    });
  });
}
