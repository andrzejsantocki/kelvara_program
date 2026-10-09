import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";

const NETWORKS = new Set(["mainnet-beta", "devnet"]);
const MAX_LIMIT = 100;
const MAX_WALLETS = 16;
const MAX_VAULTS = 32;
const MAX_ITEMS = 100;
const MAX_STRING = 512;
const MAX_DEPTH = 8;
const SENSITIVE = /rawbytes|signedtransaction|secret|token|private|seed|mnemonic|credential|password|permit|enrollment/i;
const TOP_FIELDS = new Set(["schemaVersion", "network", "freshness", "wallets", "warnings"]);
const FRESHNESS_FIELDS = new Set(["state", "observedAt", "finalizedSlot"]);
const WALLET_FIELDS = new Set(["address", "vaults"]);
const VAULT_FIELDS = new Set(["identity", "membership", "requiresAttention", "currentActions", "recentChanges", "nextHistoryCursor"]);
const IDENTITY_FIELDS = new Set(["provider", "generation", "multisigAddress", "vaultIndex", "vaultAddress"]);
const MEMBERSHIP_FIELDS = new Set(["role", "permissions", "threshold", "memberCount"]);
const ITEM_FIELDS = new Set(["id", "actionId", "changeId", "type", "status", "title", "description", "createdAt", "updatedAt", "observedAt", "target", "amount", "asset", "actor", "details"]);

function fail() { throw new Error("observation_hub_malformed"); }
function boundedString(value) { if (typeof value !== "string" || value.length > MAX_STRING || /[\u0000-\u001f\u007f]/.test(value)) fail(); return value; }
function object(value, fields, depth) {
  if (!value || typeof value !== "object" || Array.isArray(value) || depth > MAX_DEPTH) fail();
  for (const key of Object.keys(value)) { if (SENSITIVE.test(key) || !fields.has(key)) fail(); }
  return value;
}
function identity(value, depth) {
  const item = object(value, IDENTITY_FIELDS, depth); if (typeof item.provider !== "string" || typeof item.generation !== "string" || typeof item.multisigAddress !== "string" || !Number.isInteger(item.vaultIndex) || item.vaultIndex < 0 || typeof item.vaultAddress !== "string") fail();
  for (const key of ["provider", "generation", "multisigAddress", "vaultAddress"]) boundedString(item[key]);
  return { provider: item.provider, generation: item.generation, multisigAddress: item.multisigAddress, vaultIndex: item.vaultIndex, vaultAddress: item.vaultAddress };
}
function membership(value, depth) {
  const item = object(value, MEMBERSHIP_FIELDS, depth); if (typeof item.role !== "string" || !Array.isArray(item.permissions) || !Number.isInteger(item.threshold) || !Number.isInteger(item.memberCount) || item.threshold < 1 || item.memberCount < 1 || item.threshold > item.memberCount || item.permissions.length > MAX_ITEMS) fail();
  boundedString(item.role); item.permissions.forEach(boundedString); return { role: item.role, permissions: [...item.permissions], threshold: item.threshold, memberCount: item.memberCount };
}
function item(value, depth) {
  const source = object(value, ITEM_FIELDS, depth); const result = {};
  for (const [key, current] of Object.entries(source)) { if (typeof current === "string") result[key] = boundedString(current); else if (current === null || typeof current === "number" || typeof current === "boolean") result[key] = current; else if (key === "details") result[key] = sanitize(current, depth + 1); else fail(); }
  return result;
}
function sanitize(value, depth = 0) {
  if (typeof value === "string") return boundedString(value);
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) { if (value.length > MAX_ITEMS) fail(); return value.map(entry => sanitize(entry, depth + 1)); }
  const source = object(value, new Set(Object.keys(value)), depth); const result = {}; for (const [key, current] of Object.entries(source)) { if (SENSITIVE.test(key)) fail(); result[key] = sanitize(current, depth + 1); } return result;
}
function boundedEvidence(wallet, network, evidence) {
  const top = object(evidence, TOP_FIELDS, 0);
  if (top.schemaVersion !== "observation-hub-governance/v1" || top.network !== network) fail();
  const fresh = object(top.freshness, FRESHNESS_FIELDS, 1);
  if (!["fresh", "stale", "partial", "unknown"].includes(fresh.state) || typeof fresh.observedAt !== "string" || Number.isNaN(Date.parse(fresh.observedAt)) || (fresh.finalizedSlot !== null && !Number.isInteger(fresh.finalizedSlot))) fail();
  const wallets = top.wallets; if (!Array.isArray(wallets) || wallets.length > MAX_WALLETS || wallets.length !== 1) fail();
  const customer = object(wallets[0], WALLET_FIELDS, 1); if (customer.address !== wallet || !Array.isArray(customer.vaults) || customer.vaults.length > MAX_VAULTS) fail();
  const vaults = customer.vaults.map((vault, index) => { const v = object(vault, VAULT_FIELDS, 2); if (!v.identity || !v.membership || !Array.isArray(v.requiresAttention) || !Array.isArray(v.currentActions) || !Array.isArray(v.recentChanges) || v.requiresAttention.length > MAX_ITEMS || v.currentActions.length > MAX_ITEMS || v.recentChanges.length > MAX_ITEMS) fail(); return { identity: identity(v.identity, 3), membership: membership(v.membership, 3), requiresAttention: v.requiresAttention.map(x => item(x, 3)), currentActions: v.currentActions.map(x => item(x, 3)), recentChanges: v.recentChanges.map(x => item(x, 3)), nextHistoryCursor: v.nextHistoryCursor === null ? null : boundedString(v.nextHistoryCursor) }; });
  const warnings = top.warnings === undefined ? [] : top.warnings; if (!Array.isArray(warnings) || warnings.length > MAX_ITEMS) fail(); warnings.forEach(boundedString);
  if (["partial", "stale", "unknown"].includes(fresh.state)) warnings.push(`freshness_${fresh.state}`);
  return { schemaVersion: "customer-governance/v1", network, freshness: { state: fresh.state, observedAt: fresh.observedAt, finalizedSlot: fresh.finalizedSlot }, wallets: [{ address: wallet, vaults }], warnings: warnings.slice(0, 20) };
}

export function createGovernanceClient({ url, token, fetchImpl = fetch } = {}) {
  if (!url || !token) throw new Error("governance_client_config_missing");
  return async request => { const endpoint = new URL("/internal/v1/governance/actions/query", url).toString(); let response; try { response = await fetchImpl(endpoint, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(request), signal: AbortSignal.timeout(2000) }); } catch { throw new Error("observation_hub_unavailable"); } if (!response.ok) throw new Error("observation_hub_unavailable"); try { return await response.json(); } catch { throw new Error("observation_hub_malformed"); } };
}
function signCursor(cursor, wallet, network, secret) { const payload = Buffer.from(JSON.stringify({ cursor, wallet, network })).toString("base64url"); return `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`; }
function readCursor(value, wallet, network, secret) { if (!value) return null; const [payload, signature] = String(value).split("."); if (!payload || !signature) throw new Error("invalid_cursor"); const expected = createHmac("sha256", secret).update(payload).digest("base64url"); if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw new Error("invalid_cursor"); let decoded; try { decoded = JSON.parse(Buffer.from(payload, "base64url").toString()); } catch { throw new Error("invalid_cursor"); } if (decoded.wallet !== wallet || decoded.network !== network || typeof decoded.cursor !== "string" || decoded.cursor.length > MAX_STRING) throw new Error("invalid_cursor"); return decoded.cursor; }
export function createGovernanceHandler({ query, cursorSecret = randomBytes(32) }) { return async ({ wallet, network, historyLimit, cursor }) => { const upstreamCursor = readCursor(cursor, wallet, network, cursorSecret); try { const request = { chain: "solana", network, walletAddresses: [wallet], historyLimitPerVault: historyLimit, historyCursor: upstreamCursor }; const result = boundedEvidence(wallet, network, await query(request)); for (const vault of result.wallets[0].vaults) if (vault.nextHistoryCursor) vault.nextHistoryCursor = signCursor(vault.nextHistoryCursor, wallet, network, cursorSecret); return result; } catch (error) { return { schemaVersion: "customer-governance/v1", network, freshness: { state: "unavailable", observedAt: new Date().toISOString(), finalizedSlot: null }, warnings: [error.message === "observation_hub_scope_mismatch" ? "observation_hub_scope_mismatch" : "governance_data_unavailable"] }; } }; }
export function parseGovernanceQuery(url) { const network = url.searchParams.get("network"); if (!NETWORKS.has(network)) throw new Error("invalid_network"); for (const key of ["wallet", "walletAddresses"]) if (url.searchParams.has(key)) throw new Error("wallet_query_not_allowed"); const raw = url.searchParams.get("history_limit"); const historyLimit = raw === null ? 10 : Number(raw); if (!Number.isInteger(historyLimit) || historyLimit < 1 || historyLimit > MAX_LIMIT) throw new Error("invalid_history_limit"); return { network, historyLimit, cursor: url.searchParams.get("cursor") }; }
