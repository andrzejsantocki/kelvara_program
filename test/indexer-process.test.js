import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { commandForStep, compactOutput, runIndexerStep } from "../src/domains/indexer/process.js";

test("maps process stage to a bounded direct tsx invocation", () => {
  assert.deepEqual(commandForStep("recent"), ["src/index.ts", "--recent"]);
  assert.deepEqual(commandForStep("process", { processLimit: 25 }), ["src/index.ts", "--process", "--all", "--limit", "25"]);
  assert.deepEqual(commandForStep("accounts"), ["src/index.ts", "--accounts"]);
});

test("unknown runner stage is rejected", () => {
  assert.throws(() => commandForStep("crawl"), /unsupported indexer step/);
});

test("status output is bounded and keeps the end", () => {
  const text = "a".repeat(100) + "important-end";
  assert.equal(compactOutput(text, 20), "…" + text.slice(-20));
});

test("timeout terminates the detached process group instead of only its parent", async () => {
  const child = new EventEmitter();
  child.pid = 4321;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  const calls = [];
  const spawnImpl = (command, args, options) => {
    calls.push({ command, args, options });
    return child;
  };
  const killImpl = (pid, signal) => {
    calls.push({ pid, signal });
    queueMicrotask(() => child.emit("close", null, signal));
  };

  const result = await runIndexerStep("process", {
    indexerDir: "/indexer",
    timeoutMs: 1,
    processLimit: 25,
    spawnImpl,
    killImpl,
  });

  assert.equal(calls[0].command, "/indexer/node_modules/.bin/tsx");
  assert.equal(calls[0].options.detached, true);
  assert.deepEqual(calls[0].args, ["src/index.ts", "--process", "--all", "--limit", "25"]);
  assert.deepEqual(calls[1], { pid: -4321, signal: "SIGTERM" });
  assert.equal(result.timedOut, true);
  assert.match(result.output, /timed out/);
});
