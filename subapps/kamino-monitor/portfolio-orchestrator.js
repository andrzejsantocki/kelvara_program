import { validateSolanaAddress } from "../../src/domains/discovery/wallet.js";

const MAX_URL_LENGTH = 2048;
const CONFIG_FIELDS = new Set(["policyRevision", "protocols", "targets", "bindings", "ruleVersions"]);
const PROTOCOL_FIELDS = new Set(["discoveryAdapterId", "discoveryAdapterVersion", "targetIds"]);
const BINDING_FIELDS = new Set(["bindingId", "targetId", "ruleId", "ruleVersion", "display"]);
const RECEIPT_FIELDS = new Set(["bindingId", "targetId", "ruleId", "ruleVersion", "policyRevision", "result", "receiptId", "idempotencyKey"]);
function requireUrl(value, name) { if (typeof value !== "string" || value.length === 0 || value.length > MAX_URL_LENGTH) throw new Error(`${name}_invalid`); const url = new URL(value); if (!["http:", "https:"].includes(url.protocol)) throw new Error(`${name}_invalid`); return url; }
function requireToken(value) { if (typeof value !== "string" || value.length < 32) throw new Error("internal_token_invalid"); return value; }
async function postJson(url, token, payload, fetchImpl, label) {
  const response = await fetchImpl(url, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(payload), signal: AbortSignal.timeout(2000) });
  if (!response.ok) throw new Error(`${label}_unavailable`); let body; try { body = await response.json(); } catch { throw new Error(`${label}_malformed`); }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error(`${label}_malformed`); return body;
}
function closedObject(value, fields, label) { if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !fields.has(key))) throw new Error(`${label}_malformed`); return value; }
export function createControlPlaneClient({ url, token, fetchImpl = fetch }) {
  const base = requireUrl(url, "control_plane_url"); requireToken(token);
  return {
    async readManifest(wallet) { const endpoint = new URL(`/internal/v1/config/discovery-manifest?wallet=${encodeURIComponent(wallet)}`, base).toString(); const response = await fetchImpl(endpoint, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(2000) }); if (!response.ok) throw new Error("control_plane_unavailable"); try { return await response.json(); } catch { throw new Error("control_plane_malformed"); } },
    async readActive(targetIds) { return postJson(new URL("/internal/v1/config/batch-read", base).toString(), token, { targetIds }, fetchImpl, "control_plane"); },
  };
}
export function createObservationHubClient({ url, token, fetchImpl = fetch }) {
  const endpoint = new URL("/internal/evaluation-receipts/batch-read", requireUrl(url, "observation_hub_url")).toString(); requireToken(token);
  return { async readLatest(targetIds, policyRevision) { return postJson(endpoint, token, { policyRevision, targetIds }, fetchImpl, "observation_hub"); } };
}
function normalizeConfig(body) {
  const config = body.config || body; closedObject(config, CONFIG_FIELDS, "control_plane");
  if (!Number.isSafeInteger(config.policyRevision) || !Array.isArray(config.protocols) || !Array.isArray(config.targets) || !Array.isArray(config.bindings) || !config.ruleVersions || Array.isArray(config.ruleVersions)) throw new Error("control_plane_malformed");
  config.protocols.forEach(protocol => { closedObject(protocol, PROTOCOL_FIELDS, "control_plane"); if (typeof protocol.discoveryAdapterId !== "string" || typeof protocol.discoveryAdapterVersion !== "string" || !Array.isArray(protocol.targetIds)) throw new Error("control_plane_malformed"); });
  config.bindings.forEach(binding => { closedObject(binding, BINDING_FIELDS, "control_plane"); if (!["bindingId", "targetId", "ruleId", "ruleVersion"].every(key => binding[key] !== undefined)) throw new Error("control_plane_malformed"); });
  return config;
}
function normalizeReceipts(body) { if (!Array.isArray(body.receipts) || Object.keys(body).some(key => key !== "receipts")) throw new Error("observation_hub_malformed"); body.receipts.forEach(receipt => { closedObject(receipt, RECEIPT_FIELDS, "observation_hub"); }); return body.receipts; }
function normalizePosition(discovered) { return discovered?.position || null; }
export function createPortfolioOrchestrator({ configUrl, receiptsUrl, token, controlPlaneToken = token, observationHubToken = token, controlPlaneClient, observationHubClient, manifestClient, fetchImpl = fetch, adapters = {} } = {}) {
  const configClient = controlPlaneClient || createControlPlaneClient({ url: configUrl, token: controlPlaneToken, fetchImpl });
  const receiptsClient = observationHubClient || createObservationHubClient({ url: receiptsUrl, token: observationHubToken, fetchImpl });
  const discoveryClient = manifestClient || configClient;
  return { async getPortfolio(wallet) {
    if (!validateSolanaAddress(wallet)) throw new Error("invalid_wallet");
    const manifest = await (discoveryClient.read ? discoveryClient.read(wallet) : discoveryClient.readManifest(wallet)); const protocols = manifest?.protocols;
    if (!Array.isArray(protocols)) throw new Error("control_plane_malformed");
    const targetIds = protocols.flatMap(protocol => Array.isArray(protocol.targetIds) ? protocol.targetIds : []); if (targetIds.length === 0) throw new Error("active_targets_unavailable");
    const config = normalizeConfig(await configClient.readActive(targetIds)); if (config.policyRevision !== manifest.policyRevision) throw new Error("control_plane_malformed");
    const receipts = normalizeReceipts(await receiptsClient.readLatest(targetIds, config.policyRevision)); const positions = []; const protocolStatuses = [];
    for (const protocol of config.protocols) { const key = `${protocol.discoveryAdapterId}@${protocol.discoveryAdapterVersion}`, adapter = adapters[key]; if (!adapter) { protocolStatuses.push({ protocol: protocol.discoveryAdapterId, status: "unsupported" }); continue; } try { const discovered = await adapter.discover(wallet, protocol); const position = normalizePosition(discovered); if (position) positions.push(position); protocolStatuses.push({ protocol: protocol.discoveryAdapterId, status: position ? "available" : "degraded" }); } catch { protocolStatuses.push({ protocol: protocol.discoveryAdapterId, status: "unavailable" }); } }
    const safeguards = config.bindings.map(binding => { const receipt = receipts.find(item => item.bindingId === binding.bindingId && item.targetId === binding.targetId && item.ruleId === binding.ruleId && item.ruleVersion === binding.ruleVersion && item.policyRevision === config.policyRevision); return { ...binding, ...(receipt ? { result: receipt.result, receiptId: receipt.receiptId } : { result: "unknown", reason: "missing_receipt", receiptId: null }) }; });
    const satisfied = safeguards.filter(item => item.result !== "unknown").length; return { policyRevision: config.policyRevision, positions, safeguards, protocolStatuses, coverage: { state: satisfied === safeguards.length ? "complete" : "partial", expected: safeguards.length, satisfied } };
  } };
}
