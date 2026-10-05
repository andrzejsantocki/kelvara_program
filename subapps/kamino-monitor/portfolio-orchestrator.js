import { validateSolanaAddress } from "../../src/domains/discovery/wallet.js";

const MAX_URL_LENGTH = 2048;

function requireUrl(value, name) {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_URL_LENGTH) throw new Error(`${name}_invalid`);
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error(`${name}_invalid`);
  return url;
}

function requireToken(value) {
  if (typeof value !== "string" || value.length < 32) throw new Error("internal_token_invalid");
  return value;
}

async function postJson(url, token, payload, fetchImpl, label) {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(2000),
  });
  if (!response.ok) throw new Error(`${label}_unavailable`);
  let body;
  try { body = await response.json(); } catch { throw new Error(`${label}_malformed`); }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error(`${label}_malformed`);
  return body;
}

export function createControlPlaneClient({ url, token, fetchImpl = fetch }) {
  const endpoint = new URL("/internal/v1/config/batch-read", requireUrl(url, "control_plane_url")).toString();
  requireToken(token);
  return { async readActive(wallet) { return postJson(endpoint, token, { wallet, active: true }, fetchImpl, "control_plane"); } };
}

export function createObservationHubClient({ url, token, fetchImpl = fetch }) {
  const endpoint = new URL("/internal/evaluation-receipts/batch-read", requireUrl(url, "observation_hub_url")).toString();
  requireToken(token);
  return { async readLatest(wallet, targetIds, policyRevision) { return postJson(endpoint, token, { wallet, targetIds, policyRevision, latest: true }, fetchImpl, "observation_hub"); } };
}

function normalizeConfig(body) {
  const config = body.config || body;
  if (typeof config.policyRevision !== "string" || !Array.isArray(config.protocols)) throw new Error("control_plane_malformed");
  return config;
}

function normalizeReceipts(body) {
  if (!Array.isArray(body.receipts)) throw new Error("observation_hub_malformed");
  return body.receipts;
}

export function createPortfolioOrchestrator({ configUrl, receiptsUrl, token, controlPlaneToken = token, observationHubToken = token, controlPlaneClient, observationHubClient, fetchImpl = fetch, adapters = {} } = {}) {
  const configClient = controlPlaneClient || createControlPlaneClient({ url: configUrl, token: controlPlaneToken, fetchImpl });
  const receiptsClient = observationHubClient || createObservationHubClient({ url: receiptsUrl, token: observationHubToken, fetchImpl });
  return {
    async getPortfolio(wallet) {
      if (!validateSolanaAddress(wallet)) throw new Error("invalid_wallet");
      const config = normalizeConfig(await configClient.readActive(wallet));
      const protocols = config.protocols;
      const targetIds = protocols.flatMap(protocol => Array.isArray(protocol.targetIds) ? protocol.targetIds : []);
      if (targetIds.length === 0) throw new Error("active_targets_unavailable");
      const receiptBody = await receiptsClient.readLatest(wallet, targetIds, config.policyRevision);
      const receipts = normalizeReceipts(receiptBody);
      const positions = [];
      const protocolStatuses = [];
      for (const protocol of protocols) {
        const key = `${protocol.discoveryAdapterId}@${protocol.discoveryAdapterVersion}`;
        const adapter = adapters[key];
        if (!adapter) { protocolStatuses.push({ protocol: protocol.discoveryAdapterId, status: "unsupported" }); continue; }
        try {
          const discovered = await adapter.discover(wallet, protocol);
          if (discovered?.position) positions.push(discovered.position);
          protocolStatuses.push({ protocol: protocol.discoveryAdapterId, status: "active" });
        } catch { protocolStatuses.push({ protocol: protocol.discoveryAdapterId, status: "unknown" }); }
      }
      const safeguards = targetIds.map(targetId => {
        const receipt = receipts.find(item => item.targetId === targetId && item.policyRevision === config.policyRevision);
        return receipt ? { targetId, result: receipt.result, receiptId: receipt.receiptId } : { targetId, result: "unknown", receiptId: null };
      });
      const coverage = { state: safeguards.every(item => item.result !== "unknown") ? "complete" : "partial" };
      return { policyRevision: config.policyRevision, positions, safeguards, protocolStatuses, coverage };
    },
  };
}
