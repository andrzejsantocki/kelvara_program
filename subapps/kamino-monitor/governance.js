const NETWORKS = new Set(["mainnet-beta", "devnet"]);
const MAX_LIMIT = 100;

function boundedEvidence(wallet, evidence) {
  const allowed = new Set(["schemaVersion", "freshness", "wallets", "warnings"]);
  const result = { schemaVersion: "customer-governance/v1", network: evidence.network, freshness: evidence.freshness, wallets: evidence.wallets, warnings: evidence.warnings };
  if (!evidence || typeof evidence !== "object" || !evidence.freshness || !Array.isArray(evidence.wallets)) throw new Error("observation_hub_malformed");
  if (evidence.wallets.some(item => item?.address !== wallet)) throw new Error("observation_hub_scope_mismatch");
  result.wallets = evidence.wallets.filter(item => item.address === wallet).map(item => ({ address: item.address, vaults: Array.isArray(item.vaults) ? item.vaults : [] }));
  result.warnings = Array.isArray(evidence.warnings) ? evidence.warnings.slice(0, 20).map(String) : [];
  if (evidence.freshness.state === "partial" || evidence.freshness.state === "stale" || evidence.freshness.state === "unknown") result.warnings.push(`freshness_${evidence.freshness.state}`);
  return result;
}

export function createGovernanceClient({ url, token, fetchImpl = fetch } = {}) {
  if (!url || !token) throw new Error("governance_client_config_missing");
  return async request => {
    const endpoint = new URL("/internal/v1/governance/actions/query", url).toString();
    let response;
    try { response = await fetchImpl(endpoint, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(request), signal: AbortSignal.timeout(2000) }); }
    catch { throw new Error("observation_hub_unavailable"); }
    if (!response.ok) throw new Error("observation_hub_unavailable");
    try { return await response.json(); } catch { throw new Error("observation_hub_malformed"); }
  };
}

export function createGovernanceHandler({ query }) {
  return async ({ wallet, network, historyLimit, cursor }) => {
    const request = { chain: "solana", network, walletAddresses: [wallet], historyLimitPerVault: historyLimit, historyCursor: cursor ?? null };
    try { return boundedEvidence(wallet, { ...(await query(request)), network }); }
    catch (error) { return { schemaVersion: "customer-governance/v1", network, freshness: { state: "unavailable", observedAt: new Date().toISOString(), finalizedSlot: null }, warnings: [error.message === "observation_hub_scope_mismatch" ? "observation_hub_scope_mismatch" : "governance_data_unavailable"] }; }
  };
}

export function parseGovernanceQuery(url) {
  const network = url.searchParams.get("network");
  if (!NETWORKS.has(network)) throw new Error("invalid_network");
  const raw = url.searchParams.get("history_limit");
  const historyLimit = raw === null ? 10 : Number(raw);
  if (!Number.isInteger(historyLimit) || historyLimit < 1 || historyLimit > MAX_LIMIT) throw new Error("invalid_history_limit");
  return { network, historyLimit, cursor: url.searchParams.get("cursor") };
}
