import { createServer } from "node:http";

function json(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

export function createApp({ inspectSource, discoverWallet = null, getAssurance = null }) {
  return createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    if (request.method === "GET" && url.pathname === "/api/health") {
      return json(response, 200, { ok: true, service: "kelvara-onre", milestone: "indexer-bridge" });
    }
    if (request.method === "GET" && url.pathname === "/api/sources/onre-indexer") {
      try {
        const result = inspectSource();
        return json(response, result.available === false ? 503 : 200, result);
      } catch (error) {
        return json(response, 503, { available: false, reason: "source_inspection_failed", message: error.message });
      }
    }
    const assuranceMatch = request.method === "GET" && url.pathname.match(/^\/api\/wallets\/([^/]+)\/assurance$/);
    if (assuranceMatch && getAssurance) {
      try {
        return json(response, 200, await getAssurance(decodeURIComponent(assuranceMatch[1])));
      } catch (error) {
        const status = error.message === "invalid_wallet" ? 400 : error.message === "supported_position_not_found" ? 404 : error.message === "all_rpc_sources_failed" ? 503 : 500;
        return json(response, status, { error: error.message });
      }
    }
    const walletMatch = request.method === "GET" && url.pathname.match(/^\/api\/wallets\/([^/]+)\/positions$/);
    if (walletMatch && discoverWallet) {
      try {
        return json(response, 200, await discoverWallet(decodeURIComponent(walletMatch[1])));
      } catch (error) {
        const status = error.message === "invalid_wallet" ? 400 : error.message === "all_rpc_sources_failed" ? 503 : 500;
        return json(response, status, { error: error.message });
      }
    }
    return json(response, 404, { error: "not_found" });
  });
}
