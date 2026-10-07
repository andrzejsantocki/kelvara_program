import { createHash, randomBytes } from "node:crypto";
import nacl from "tweetnacl";
import { PublicKey } from "@solana/web3.js";

const MAX_RESPONSE_BYTES = 64 * 1024;

async function readBoundedJson(response, label, timeoutMs = 2000) {
  if (!response || !response.ok) throw new Error(`${label}_http_error`);
  let timer;
  try {
    const raw = await Promise.race([
      response.body && typeof response.body[Symbol.asyncIterator] === "function"
        ? (async () => { const chunks = []; let total = 0; for await (const chunk of response.body) { const bytes = Buffer.from(chunk); total += bytes.length; if (total > MAX_RESPONSE_BYTES) throw new Error(`${label}_body_too_large`); chunks.push(bytes); } return Buffer.concat(chunks).toString("utf8"); })()
        : (() => { const declared = Number(response.headers?.get?.("content-length") ?? response.headers?.["content-length"]); if (!Number.isInteger(declared) || declared < 0 || declared > MAX_RESPONSE_BYTES || typeof response.text !== "function") throw new Error(`${label}_unbounded_response`); return response.text(); })(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label}_timeout`)), timeoutMs); }),
    ]);
    if (Buffer.byteLength(raw) > MAX_RESPONSE_BYTES) throw new Error(`${label}_body_too_large`);
    try { return JSON.parse(raw); } catch { throw new Error(`${label}_malformed`); }
  } finally { clearTimeout(timer); }
}

export { readBoundedJson };

export const NETWORK_GENESIS = Object.freeze({
  "mainnet-beta": "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
  devnet: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
});
const NETWORKS = new Set(Object.keys(NETWORK_GENESIS));
const AUTH_PREFIX = "Kelvara wallet authentication";

function validNetwork(network) {
  if (!NETWORKS.has(network)) throw new Error("unsupported_network");
  return network;
}
function hashToken(token) { return createHash("sha256").update(token).digest("hex"); }
function boundedString(value, name) {
  if (typeof value !== "string" || !value || value.length > 1000) throw new Error(`invalid_${name}`);
  return value;
}

export function createGenesisVerifier({network, rpcUrl, fetchImpl=fetch, timeoutMs=2000}={}) {
  validNetwork(network);
  if (typeof rpcUrl !== "string" || !rpcUrl) throw new Error("rpc_url_required");
  return {
    network,
    rpcUrl,
    async verify() {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
      try {
        const request = fetchImpl(rpcUrl, { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({jsonrpc:"2.0", id:1, method:"getGenesisHash", params:[]}), signal: controller.signal });
        const readResponse = async () => readBoundedJson(await request, "genesis_rpc", timeoutMs);
        const body = await Promise.race([readResponse(), new Promise((_, reject) => setTimeout(() => reject(new Error("genesis_rpc_timeout")), Math.max(1, timeoutMs)))]);
        if (!body || body.jsonrpc !== "2.0" || body.id !== 1 || typeof body.result !== "string" || body.error) throw new Error("genesis_rpc_malformed");
        const expected = NETWORK_GENESIS[network];
        if (body.result !== expected) throw new Error("genesis_hash_mismatch");
        return {network, genesisHash: body.result, rpcUrl};
      } catch (error) {
        if (error.name === "AbortError") throw new Error("genesis_rpc_timeout");
        throw error;
      } finally { clearTimeout(timer); }
    }
  };
}

export function createNetworkBoundWalletAuth({genesisVerifier, ttlMs=5*60_000, now=()=>Date.now()}={}) {
  const challenges = new Map(), sessions = new Map();
  return {
    networkBound: true,
    async issue(wallet, network) {
      new PublicKey(wallet); validNetwork(network);
      if (!genesisVerifier || genesisVerifier.network !== network) throw new Error("network_verification_unavailable");
      const verified = await genesisVerifier.verify();
      const nonce = randomBytes(24).toString("base64url"), expiresAt = now() + ttlMs;
      const message = `${AUTH_PREFIX}\nWallet: ${wallet}\nNetwork: ${network}\nGenesis: ${verified.genesisHash}\nNonce: ${nonce}\nExpires: ${expiresAt}`;
      challenges.set(nonce, {wallet, network, genesisHash: verified.genesisHash, message, expiresAt});
      return {message, expiresAt, network, genesisHash: verified.genesisHash};
    },
    async verify(wallet, message, signature, network) {
      new PublicKey(wallet); boundedString(message, "challenge_message"); validNetwork(network);
      const nonce = /\nNonce: ([^\n]+)/.exec(message)?.[1], entry = nonce && challenges.get(nonce);
      if (!entry || entry.wallet !== wallet || entry.network !== network || entry.message !== message || entry.expiresAt <= now()) throw new Error("invalid_or_expired_challenge");
      challenges.delete(nonce);
      const verified = await genesisVerifier.verify();
      if (verified.genesisHash !== entry.genesisHash) throw new Error("genesis_binding_stale");
      let ok = false;
      try { ok = nacl.sign.detached.verify(Buffer.from(message), Buffer.from(signature, "base64"), new PublicKey(wallet).toBytes()); } catch {}
      if (!ok) throw new Error("invalid_wallet_signature");
      const token = randomBytes(32).toString("base64url"), expiresAt = now() + ttlMs;
      sessions.set(hashToken(token), {wallet, network, genesisHash: verified.genesisHash, expiresAt});
      return {token, expiresAt, network, genesisHash: verified.genesisHash};
    },
    async authorize(token, binding={}) {
      if (!token) throw new Error("authentication_required");
      const session = sessions.get(hashToken(token));
      if (!session || session.expiresAt <= now()) throw new Error("authentication_required");
      if (binding.network !== session.network || binding.genesisHash !== session.genesisHash) throw new Error("network_binding_mismatch");
      const current = await genesisVerifier.verify();
      if (current.genesisHash !== session.genesisHash) throw new Error("genesis_binding_stale");
      return session.wallet;
    }
  };
}
