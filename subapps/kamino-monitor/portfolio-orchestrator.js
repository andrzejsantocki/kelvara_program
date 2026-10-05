import { validateSolanaAddress } from "../../src/domains/discovery/wallet.js";

const MAX_URL_LENGTH = 2048;
const MANIFEST_FIELDS = new Set(["policyRevision", "protocols", "targets"]);
const MANIFEST_PROTOCOL_FIELDS = new Set(["id", "name", "chain", "status", "discoveryAdapterId", "discoveryAdapterVersion"]);
const MANIFEST_TARGET_FIELDS = new Set(["id", "protocolId", "kind", "name", "status"]);
const CONFIG_FIELDS = new Set(["policyRevision", "protocols", "targets", "bindings", "ruleVersions"]);
const CONFIG_PROTOCOL_FIELDS = new Set(["id", "name", "chain", "status", "discoveryAdapterId", "discoveryAdapterVersion", "targetIds"]);
const CONFIG_TARGET_FIELDS = new Set(["id", "protocolId", "kind", "name", "status"]);
const BINDING_FIELDS = new Set(["bindingId", "targetId", "ruleId", "ruleVersion", "display"]);
const RULE_VERSION_FIELDS = new Set(["ruleId", "version", "evaluatorType", "evaluatorVersion", "parameters", "evidenceSchema", "contentHash"]);
const RECEIPT_FIELDS = new Set(["receiptId", "idempotencyKey", "policyRevision", "ruleId", "ruleVersion", "bindingId", "targetId", "evidenceRefs", "evaluatorVersion", "result", "evaluatedAt", "observedAt", "provenance"]);
const RECEIPT_RESULTS = new Set(["pass", "fail", "unknown", "stale"]);
const ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

function requireUrl(value, name) { if (typeof value !== "string" || value.length === 0 || value.length > MAX_URL_LENGTH) throw new Error(`${name}_invalid`); const url = new URL(value); if (!["http:", "https:"].includes(url.protocol)) throw new Error(`${name}_invalid`); return url; }
function requireToken(value) { if (typeof value !== "string" || value.length < 32) throw new Error("internal_token_invalid"); return value; }
async function postJson(url, token, payload, fetchImpl, label) { const response = await fetchImpl(url, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(payload), signal: AbortSignal.timeout(2000) }); if (!response.ok) throw new Error(`${label}_unavailable`); let body; try { body = await response.json(); } catch { throw new Error(`${label}_malformed`); } if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error(`${label}_malformed`); return body; }
function closedObject(value, fields, label) { if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !fields.has(key))) throw new Error(`${label}_malformed`); return value; }
function validId(value) { return typeof value === "string" && ID_PATTERN.test(value) && value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value); }
function uniqueIds(items, field = "id") { const ids = items.map(item => item[field]); if (ids.some(id => !validId(id)) || new Set(ids).size !== ids.length) throw new Error("control_plane_malformed"); }
function validVersion(value) { return Number.isSafeInteger(value) && value >= 1; }
function validRuleVersion(value) {
  closedObject(value, RULE_VERSION_FIELDS, "control_plane");
  if (!validId(value.ruleId) || !validVersion(value.version) || typeof value.evaluatorType !== "string" || !value.evaluatorType || typeof value.evaluatorVersion !== "string" || !value.evaluatorVersion || typeof value.evidenceSchema !== "string" || !value.evidenceSchema || typeof value.contentHash !== "string" || !/^[0-9a-f]{64}$/.test(value.contentHash) || !value.parameters || typeof value.parameters !== "object" || Array.isArray(value.parameters)) throw new Error("control_plane_malformed");
}
function validateManifest(body) {
  const manifest = closedObject(body, MANIFEST_FIELDS, "control_plane");
  if (!Number.isSafeInteger(manifest.policyRevision) || manifest.policyRevision < 1 || !Array.isArray(manifest.protocols) || !Array.isArray(manifest.targets)) throw new Error("control_plane_malformed");
  manifest.protocols.forEach(protocol => { closedObject(protocol, MANIFEST_PROTOCOL_FIELDS, "control_plane"); if (!["name", "chain", "status", "discoveryAdapterId"].every(key => typeof protocol[key] === "string" && protocol[key])) throw new Error("control_plane_malformed"); if (!validVersion(protocol.discoveryAdapterVersion)) throw new Error("control_plane_malformed"); });
  manifest.targets.forEach(target => { closedObject(target, MANIFEST_TARGET_FIELDS, "control_plane"); if (!["protocolId", "kind", "name", "status"].every(key => typeof target[key] === "string" && target[key])) throw new Error("control_plane_malformed"); });
  uniqueIds(manifest.protocols); uniqueIds(manifest.targets);
  const protocols = new Map(manifest.protocols.map(protocol => [protocol.id, protocol]));
  if (manifest.protocols.length === 0 || manifest.targets.length === 0 || manifest.protocols.every(protocol => protocol.status !== "active") || manifest.targets.every(target => target.status !== "active")) throw new Error("active_targets_unavailable");
  for (const target of manifest.targets) if (!protocols.has(target.protocolId)) throw new Error("control_plane_malformed");
  return manifest;
}
function normalizeConfig(body) {
  const config = closedObject(body.config || body, CONFIG_FIELDS, "control_plane");
  if (!Number.isSafeInteger(config.policyRevision) || config.policyRevision < 1 || !Array.isArray(config.protocols) || !Array.isArray(config.targets) || !Array.isArray(config.bindings) || !Array.isArray(config.ruleVersions) || config.ruleVersions.length > 1000) throw new Error("control_plane_malformed");
  config.ruleVersions.forEach(validRuleVersion); const rules = new Set(config.ruleVersions.map(rule => `${rule.ruleId}:${rule.version}`)); if (new Set(config.bindings.map(binding => binding.bindingId)).size !== config.bindings.length) throw new Error("control_plane_malformed");
  config.protocols.forEach(protocol => { closedObject(protocol, CONFIG_PROTOCOL_FIELDS, "control_plane"); if (!["id", "name", "chain", "status", "discoveryAdapterId"].every(key => typeof protocol[key] === "string" && protocol[key]) || !validVersion(protocol.discoveryAdapterVersion) || !Array.isArray(protocol.targetIds)) throw new Error("control_plane_malformed"); });
  config.targets.forEach(target => { closedObject(target, CONFIG_TARGET_FIELDS, "control_plane"); if (!["id", "protocolId", "kind", "name", "status"].every(key => typeof target[key] === "string" && target[key])) throw new Error("control_plane_malformed"); });
  uniqueIds(config.protocols); uniqueIds(config.targets); config.protocols.forEach(protocol => { if (new Set(protocol.targetIds).size !== protocol.targetIds.length || protocol.targetIds.some(id => !validId(id))) throw new Error("control_plane_malformed"); });
  config.bindings.forEach(binding => { closedObject(binding, BINDING_FIELDS, "control_plane"); if (!["bindingId", "targetId", "ruleId"].every(key => validId(binding[key])) || !validVersion(binding.ruleVersion) || !binding.display || typeof binding.display !== "object" || Array.isArray(binding.display) || Object.keys(binding.display).some(key => key !== "name") || !validId(binding.display.name) || !rules.has(`${binding.ruleId}:${binding.ruleVersion}`) || !config.targets.some(target => target.id === binding.targetId) || !config.protocols.some(protocol => protocol.targetIds.includes(binding.targetId) && config.targets.some(target => target.id === binding.targetId && target.protocolId === protocol.id))) throw new Error("control_plane_malformed"); });
  if (config.protocols.some(protocol => protocol.targetIds.some(targetId => !config.targets.some(target => target.id === targetId && target.protocolId === protocol.id)))) throw new Error("control_plane_malformed");
  return config;
}
function validateAgainstManifest(config, manifest) {
  if (config.policyRevision !== manifest.policyRevision) throw new Error("control_plane_malformed");
  const manifestProtocols = new Map(manifest.protocols.map(item => [item.id, item]));
  const manifestTargets = new Map(manifest.targets.map(item => [item.id, item]));
  if (config.protocols.length !== manifest.protocols.length || config.targets.length !== manifest.targets.length) throw new Error("control_plane_malformed");
  for (const protocol of config.protocols) { const expected = manifestProtocols.get(protocol.id); if (!expected || protocol.discoveryAdapterId !== expected.discoveryAdapterId || protocol.discoveryAdapterVersion !== expected.discoveryAdapterVersion || protocol.name !== expected.name || protocol.chain !== expected.chain || protocol.status !== expected.status) throw new Error("control_plane_malformed"); const expectedIds = manifest.targets.filter(target => target.protocolId === protocol.id).map(target => target.id); if (expectedIds.length !== protocol.targetIds.length || expectedIds.some((id, index) => id !== protocol.targetIds[index])) throw new Error("control_plane_malformed"); }
  for (const target of config.targets) { const expected = manifestTargets.get(target.id); if (!expected || JSON.stringify(target) !== JSON.stringify(expected)) throw new Error("control_plane_malformed"); }
  if (config.targets.some(target => !manifestTargets.has(target.id))) throw new Error("control_plane_malformed");
  return config;
}
function normalizeReceipts(body) { if (!body || typeof body !== "object" || Array.isArray(body) || !Number.isSafeInteger(body.policyRevision) || body.policyRevision < 1 || !Array.isArray(body.receipts) || Object.keys(body).some(key => !["policyRevision", "receipts"].includes(key))) throw new Error("observation_hub_malformed"); body.receipts.forEach(receipt => { closedObject(receipt, RECEIPT_FIELDS, "observation_hub"); if (!["receiptId", "idempotencyKey", "ruleId", "bindingId", "targetId", "evaluatorVersion", "evaluatedAt", "observedAt"].every(key => validId(receipt[key])) || !Number.isSafeInteger(receipt.policyRevision) || receipt.policyRevision < 1 || !validVersion(receipt.ruleVersion) || !Array.isArray(receipt.evidenceRefs) || receipt.evidenceRefs.length < 1 || receipt.evidenceRefs.length > 128 || receipt.evidenceRefs.some(item => !validId(item)) || !RECEIPT_RESULTS.has(receipt.result) || !receipt.provenance || typeof receipt.provenance !== "object" || Array.isArray(receipt.provenance) || typeof receipt.provenance.sourceId !== "string" || typeof receipt.provenance.schemaVersion !== "string" || typeof receipt.provenance.producerVersion !== "string") throw new Error("observation_hub_malformed"); }); return body; }
function normalizePosition(discovered) { return discovered?.position || null; }

export function createControlPlaneClient({ url, token, fetchImpl = fetch }) { const base = requireUrl(url, "control_plane_url"); requireToken(token); return { async readManifest() { const endpoint = new URL("/internal/v1/config/discovery-manifest", base).toString(); const response = await fetchImpl(endpoint, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(2000) }); if (!response.ok) throw new Error("control_plane_unavailable"); try { return await response.json(); } catch { throw new Error("control_plane_malformed"); } }, async readActive(targetIds) { return postJson(new URL("/internal/v1/config/batch-read", base).toString(), token, { targetIds }, fetchImpl, "control_plane"); } }; }
export function createObservationHubClient({ url, token, fetchImpl = fetch }) { const endpoint = new URL("/internal/evaluation-receipts/batch-read", requireUrl(url, "observation_hub_url")).toString(); requireToken(token); return { async readLatest(targetIds, policyRevision) { return postJson(endpoint, token, { policyRevision, targetIds }, fetchImpl, "observation_hub"); } }; }

export function createPortfolioOrchestrator({ configUrl, receiptsUrl, token, controlPlaneToken = token, observationHubToken = token, controlPlaneClient, observationHubClient, manifestClient, fetchImpl = fetch, adapters = {} } = {}) {
  const configClient = controlPlaneClient || createControlPlaneClient({ url: configUrl, token: controlPlaneToken, fetchImpl }); const receiptsClient = observationHubClient || createObservationHubClient({ url: receiptsUrl, token: observationHubToken, fetchImpl }); const discoveryClient = manifestClient || configClient;
  return { async getPortfolio(wallet) {
    if (!validateSolanaAddress(wallet)) throw new Error("invalid_wallet");
    const manifest = validateManifest(await (discoveryClient.read ? discoveryClient.read(wallet) : discoveryClient.readManifest()));
    const activeTargets = manifest.targets.filter(target => target.status === "active" && manifest.protocols.some(protocol => protocol.id === target.protocolId && protocol.status === "active"));
    if (activeTargets.length === 0) throw new Error("active_targets_unavailable");
    const targetIds = activeTargets.map(target => target.id); const config = validateAgainstManifest(normalizeConfig(await configClient.readActive(targetIds)), manifest); const receiptPayload = normalizeReceipts(await receiptsClient.readLatest(targetIds, config.policyRevision)); if (receiptPayload.policyRevision !== config.policyRevision) throw new Error("observation_hub_malformed"); const receipts = receiptPayload.receipts; const positions = []; const protocolStatuses = [];
    for (const protocol of config.protocols.filter(item => item.status === "active")) { const targets = activeTargets.filter(target => target.protocolId === protocol.id); const adapter = adapters[`${protocol.discoveryAdapterId}@${protocol.discoveryAdapterVersion}`]; const enriched = { ...protocol, targets, targetIds: targets.map(target => target.id) }; if (!adapter) { protocolStatuses.push({ protocol: protocol.discoveryAdapterId, status: "unsupported" }); continue; } try { const discovered = await adapter.discover(wallet, enriched); const position = normalizePosition(discovered); if (position) positions.push(position); protocolStatuses.push({ protocol: protocol.discoveryAdapterId, status: position ? "available" : "degraded" }); } catch { protocolStatuses.push({ protocol: protocol.discoveryAdapterId, status: "unavailable" }); } }
    const safeguards = config.bindings.map(binding => { const receipt = receipts.find(item => item.bindingId === binding.bindingId && item.targetId === binding.targetId && item.ruleId === binding.ruleId && item.ruleVersion === binding.ruleVersion && item.policyRevision === config.policyRevision); return { ...binding, ...(receipt ? { result: receipt.result, receiptId: receipt.receiptId } : { result: "unknown", reason: "missing_receipt", receiptId: null }) }; }); const satisfied = safeguards.filter(item => item.result !== "unknown").length; return { policyRevision: config.policyRevision, positions, safeguards, protocolStatuses, coverage: { state: satisfied === safeguards.length ? "complete" : "partial", expected: safeguards.length, satisfied } };
  } };
}
