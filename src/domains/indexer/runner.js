const STEPS = ["recent", "process", "accounts"];

export function createIngestionRunner({ runStep, inspectSource, writeStatus = () => {}, now = () => Math.floor(Date.now() / 1000) }) {
  let running = false;
  let status = { state: "never-run", lastResult: null };
  let cycle = 0;

  async function runOnce() {
    if (running) return { ok: false, skipped: true, reason: "cycle_already_running" };
    running = true;
    cycle += 1;
    const startedAt = now();
    status = { state: "running", cycle, startedAt, lastResult: status.lastResult };
    writeStatus(status);
    const steps = [];
    try {
      for (const step of STEPS) {
        status = { ...status, stage: step };
        writeStatus(status);
        const result = await runStep(step);
        steps.push({ step, ...result });
        if (result.code !== 0) {
          const failed = { ok: false, cycle, startedAt, finishedAt: now(), failedStep: step, error: result.output, steps };
          status = { state: "failed", cycle, lastResult: failed };
          writeStatus(status);
          return failed;
        }
      }
      const succeeded = { ok: true, cycle, startedAt, finishedAt: now(), steps, source: inspectSource() };
      status = { state: "idle", cycle, lastResult: succeeded };
      writeStatus(status);
      return succeeded;
    } catch (error) {
      const failed = { ok: false, cycle, startedAt, finishedAt: now(), failedStep: steps.at(-1)?.step ?? "recent", error: error.message, steps };
      status = { state: "failed", cycle, lastResult: failed };
      writeStatus(status);
      return failed;
    } finally {
      running = false;
    }
  }

  return { runOnce, getStatus: () => status };
}
