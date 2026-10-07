let nextId = 1;
const MAX_RESPONSE_BYTES = 64 * 1024;

async function readBoundedJson(response, label) {
  if (!response || !response.ok) throw new Error(`${label}_http_error`);
  let raw = "";
  if (response.body && Symbol.asyncIterator in Object(response.body)) {
    for await (const chunk of response.body) {
      raw += Buffer.from(chunk).toString("utf8");
      if (Buffer.byteLength(raw) > MAX_RESPONSE_BYTES) throw new Error(`${label}_body_too_large`);
    }
  } else if (typeof response.text === "function") {
    const declared = Number(response.headers?.get?.("content-length") ?? response.headers?.["content-length"]);
    if (!Number.isInteger(declared) || declared < 0 || declared > MAX_RESPONSE_BYTES) throw new Error(`${label}_unbounded_response`);
    raw = await response.text();
    if (Buffer.byteLength(raw) > MAX_RESPONSE_BYTES) throw new Error(`${label}_body_too_large`);
  } else throw new Error(`${label}_unbounded_response`);
  try { return JSON.parse(raw); } catch { throw new Error(`${label}_malformed`); }
}

export function createSolanaRpc(url, { name = "rpc", fetchImpl = fetch } = {}) {
  async function call(method, params) {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
    });
    if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
    const payload = await readBoundedJson(response, `${name}_rpc`);
    if (payload.error) throw new Error(`${name}: ${payload.error.message || "RPC error"}`);
    return payload.result;
  }

  return {
    name,
    async getAccount(address) {
      const result = await call("getAccountInfo", [address, { encoding: "base64", commitment: "confirmed" }]);
      if (!result?.value) throw new Error(`${name}: account_not_found`);
      const [encoded, encoding] = result.value.data || [];
      if (encoding !== "base64" || typeof encoded !== "string") throw new Error(`${name}: unsupported_account_encoding`);
      return {
        slot: result.context?.slot ?? null,
        owner: result.value.owner,
        executable: Boolean(result.value.executable),
        lamports: result.value.lamports,
        data: Buffer.from(encoded, "base64"),
      };
    },
    async getTokenAccounts(wallet, programId) {
      const result = await call("getTokenAccountsByOwner", [wallet, { programId }, { encoding: "jsonParsed", commitment: "confirmed" }]);
      return result.value.map(row => {
        const info = row.account?.data?.parsed?.info;
        if (!info?.tokenAmount) throw new Error(`${name}: malformed token account response`);
        return {
          pubkey: row.pubkey,
          program: row.account.owner,
          slot: result.context?.slot ?? null,
          parsed: {
            mint: info.mint,
            owner: info.owner,
            amount: String(info.tokenAmount.amount),
            decimals: Number(info.tokenAmount.decimals),
          },
        };
      });
    },
    async getTokenAccount(address) {
      const result = await call("getAccountInfo", [address, { encoding: "jsonParsed", commitment: "confirmed" }]);
      const value = result?.value;
      const info = value?.data?.parsed?.info;
      if (!info?.tokenAmount || !info.mint || !info.owner) return null;
      return {
        pubkey: address,
        program: value.owner,
        slot: result.context?.slot ?? null,
        parsed: {
          mint: info.mint,
          owner: info.owner,
          amount: String(info.tokenAmount.amount),
          decimals: Number(info.tokenAmount.decimals),
        },
      };
    },
  };
}
