const DEFAULT_TIMEOUT_MS = 2000;
const DEFAULT_MAX_BYTES = 256 * 1024;

function timeoutError(label) { return new Error(`${label}_timeout`); }
function raceDeadline(promise, timeoutMs, label) {
  let timer;
  const deadline = new Promise((_, reject) => { timer = setTimeout(() => reject(timeoutError(label)), timeoutMs); });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

export async function readBoundedJson(response, { label, timeoutMs = DEFAULT_TIMEOUT_MS, maxBytes = DEFAULT_MAX_BYTES } = {}) {
  if (!response || !response.ok) throw new Error(`${label}_unavailable`);
  const declared = Number(response.headers?.get?.("content-length") ?? response.headers?.["content-length"]);
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error(`${label}_too_large`);
  if (!response.body || typeof response.body[Symbol.asyncIterator] !== "function") throw new Error(`${label}_body_unavailable`);
  const chunks = []; let total = 0;
  try {
    await raceDeadline((async () => {
      for await (const chunk of response.body) {
        const bytes = Buffer.from(chunk); total += bytes.byteLength;
        if (total > maxBytes) throw new Error(`${label}_too_large`);
        chunks.push(bytes);
      }
    })(), timeoutMs, label);
  } catch (error) {
    if (error.message === `${label}_too_large` || error.message === `${label}_timeout`) throw error;
    throw new Error(`${label}_body_read_failed`);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new Error(`${label}_malformed`); }
}

export async function fetchBoundedJson(url, options = {}, { label, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS, maxBytes = DEFAULT_MAX_BYTES } = {}) {
  const controller = new AbortController();
  const request = Promise.resolve().then(() => fetchImpl(url, { ...options, signal: controller.signal }));
  try {
    const response = await raceDeadline(request, timeoutMs, label);
    return await readBoundedJson(response, { label, timeoutMs, maxBytes });
  } finally { controller.abort(); }
}

export { DEFAULT_TIMEOUT_MS, DEFAULT_MAX_BYTES };
