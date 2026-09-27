import { resolve } from "node:path";
import { createApp } from "./app.js";
import { inspectIndexer } from "../../domains/indexer/inspect.js";
import { discoverWallet } from "../../domains/discovery/wallet.js";
import { createSolanaRpc } from "../solana/rpc.js";
import { buildOnreBaseline } from "../../domains/protocols/onre/baseline.js";
import { ONYC_MINT, ONRE_PROGRAM_ID } from "../../domains/discovery/wallet.js";

const defaultSource = "/home/andy/kelvara-build/[codebase]/indexer_anchor_protocol/indexer.db";
const sourcePath = resolve(process.env.KELVARA_INDEXER_DB_PATH || defaultSource);
const port = Number(process.env.PORT || 7610);
const maxAgeSeconds = Number(process.env.INDEXER_MAX_AGE_SECONDS || 30);
const tokenPrograms = [
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
];
const rpcUrls = [process.env.HELIUS_RPC_1, process.env.HELIUS_RPC_2, process.env.SOLANA_RPC_URL]
  .filter(Boolean)
  .filter((url, index, all) => all.indexOf(url) === index);
if (!rpcUrls.length) rpcUrls.push("https://api.mainnet-beta.solana.com");
const rpcs = rpcUrls.map((url, index) => createSolanaRpc(url, { name: `mainnet-${index + 1}` }));

async function getAssurance(wallet) {
  const discovery = await discoverWallet(wallet, { rpcs, tokenPrograms });
  const position = discovery.positions[0];
  if (!position) throw new Error("supported_position_not_found");
  const assurance = await buildOnreBaseline({
    programId: ONRE_PROGRAM_ID,
    mint: ONYC_MINT,
    rpcs,
    observedAt: new Date().toISOString(),
  });
  return { wallet, sourceStatus: discovery.sourceStatus, position, assurance };
}

const app = createApp({
  inspectSource: () => inspectIndexer(sourcePath, { maxAgeSeconds }),
  discoverWallet: wallet => discoverWallet(wallet, { rpcs, tokenPrograms }),
  getAssurance,
});
app.listen(port, "127.0.0.1", () => {
  console.log(`kelvara-onre listening on http://127.0.0.1:${port}; RPC providers=${rpcs.length}`);
});
