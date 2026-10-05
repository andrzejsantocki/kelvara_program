import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { commandForStep, compactOutput, runIndexerStep } from "../src/domains/indexer/process.js";

function fakeChild(pid = 4321) {
  const child = new EventEmitter();
  child.pid = pid;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  return child;
}

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

test("abort terminates the detached process group and waits for child close", async () => {
  const child = fakeChild(4321);
  const controller = new AbortController();
  const calls = [];
  const promise = runIndexerStep("recent", {
    indexerDir: "/indexer",
    signal: controller.signal,
    spawnImpl: () => child,
    killImpl: (pid, signal) => calls.push({ pid, signal }),
  });
  let resolved = false;
  promise.then(() => { resolved = true; });

  controller.abort();
  await Promise.resolve();

  assert.deepEqual(calls, [{ pid: -4321, signal: "SIGTERM" }]);
  assert.equal(resolved, false);

  child.emit("close", null, "SIGTERM");
  const result = await promise;
  assert.equal(result.code, -1);
  assert.equal(result.timedOut, false);
  assert.match(result.output, /aborted/);
});

test("abort escalates to SIGKILL after the bounded grace and still waits for close", async () => {
  const child = fakeChild(7654);
  const controller = new AbortController();
  const calls = [];
  const timers = [];
  const promise = runIndexerStep("accounts", {
    indexerDir: "/indexer",
    signal: controller.signal,
    terminationGraceMs: 50,
    spawnImpl: () => child,
    killImpl: (pid, signal) => calls.push({ pid, signal }),
    setTimeoutImpl: (callback, delay) => {
      timers.push({ callback, delay });
      return timers.length;
    },
    clearTimeoutImpl: () => {},
  });
  let resolved = false;
  promise.then(() => { resolved = true; });

  controller.abort();
  assert.deepEqual(calls, [{ pid: -7654, signal: "SIGTERM" }]);
  assert.equal(timers[1].delay, 50);

  timers[1].callback();
  await Promise.resolve();
  assert.deepEqual(calls, [
    { pid: -7654, signal: "SIGTERM" },
    { pid: -7654, signal: "SIGKILL" },
  ]);
  assert.equal(resolved, false);

  child.emit("close", null, "SIGKILL");
  const result = await promise;
  assert.match(result.output, /termination grace expired after 50ms/);
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
