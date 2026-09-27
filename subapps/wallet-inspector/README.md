# Kelvara Wallet Inspector

Independent, read-only local UI for discovering an exact ONYC position from a wallet or token-account address and displaying current ONRE control evidence.

The UI is intentionally minimal, always light, and includes explicit Mainnet, Devnet, and `devnet-fixture` selection. It also shows the fixture position, Alert Console output, and health for only the core runtime services: Wallet Inspector, Fixture Lab, and Alert Console. `9GEMGj45WgCHZ6d7em4K1drmwSjJU3v5CZQ8dLhFnHYM` is a known mainnet ONYC token account; the inspector resolves it to owner wallet `E3NiM5n6s5CKKWrrhaeVjVSTKscRrysCtZeXnxn6yMgp`.

The monitored-token list includes an explicitly simulated `ONRE_DEV` fixture holder. It is not a deployed devnet account and is always labeled `fixture-only-not-chain-data`.

## Progress

Status: MVP discovery proof complete.

Completed:

- [x] Independently runnable subapp under `subapps/wallet-inspector`.
- [x] Minimal always-light UI.
- [x] Explicit Mainnet/Devnet selector.
- [x] Standalone CLI with mandatory `--cluster mainnet|devnet`.
- [x] Wallet-address discovery across SPL Token and Token-2022 accounts.
- [x] Exact monitored-mint matching; no symbol/name matching.
- [x] Token-account input resolution to its owner wallet.
- [x] Monitored-mint input recognition without inventing a holder balance.
- [x] ONRE control evidence with truthful source/degradation status.
- [x] JSON output from UI and CLI.
- [x] Safe launcher that replaces only an existing Wallet Inspector process.
- [x] Deterministic `ONRE_DEV` fixture holder integrated with Wallet Inspector.
- [x] Fixture scenarios produce rule results and Alert Console events.

Fixture proof:

```text
Holder: 4g7kC6haaE6MzUx428DRdfrgHmwo7Sj5XYAqkx4ys3Rt
Token account: FrnmPoRJ33vJhDd68jCQt7nMiV6gRsrjvTHoM5JtzNzx
Balance: 1,000,000 ONYC
Mode: fixture_simulation / fixture-only-not-chain-data
```

Start all three UIs from the project root:

```bash
./start.sh
```

The longer equivalent is `./subapps/protocol-fixture-lab/start-integrated.sh`.

Verified mainnet proof:

```text
Monitored mint: 5Y8NV33Vv7WbnLfq3zBcKSdYPrk7g2KoiQoe7M2tcxp5
Known token account: 9GEMGj45WgCHZ6d7em4K1drmwSjJU3v5CZQ8dLhFnHYM
Resolved owner: E3NiM5n6s5CKKWrrhaeVjVSTKscRrysCtZeXnxn6yMgp
Observed balance: 7,747,479.108350823 ONYC
```

This proves the discovery path:

```text
public address → exact ONYC mint match → token account evidence → owner wallet → ONRE assurance
```

Current verification:

- Focused discovery, CLI, and subapp tests: 22/22 passed.
- JavaScript syntax checks: passed.
- Live mainnet ONYC mint inspection: passed.
- Live devnet empty-position inspection: passed.

Future work:

- [ ] Deploy or clone the ONRE local fork on devnet.
- [ ] Replace `ONRE_DEV` placeholder with real devnet program/mint pubkeys.
- [ ] Add deterministic devnet fixtures and control-change scenarios.
- [ ] Require two independent agreeing RPC providers before labeling evidence `verified`.

## Expected interaction experience

1. Start the integrated stack with `./subapps/protocol-fixture-lab/start-integrated.sh`. Alert state begins empty.
2. Open `http://127.0.0.1:7620`; confirm Wallet Inspector, Fixture Lab, and Alert Console are healthy.
3. Keep `devnet-fixture` selected and click `Connect fixture wallet`.
4. The deterministic wallet and its 1,000,000 ONYC position appear. No signing, extension approval, or private key is involved.
5. Open Alert Console at `http://127.0.0.1:7623` and activate pause, authority, or vault simulation.
6. Within five seconds, this frontend shows the alert, lifecycle/severity, affected program, and plain-language **What this represents on Solana** comment.
7. Clear fixture alerts in Alert Console; this frontend returns to `No fixture alerts`.
8. Switching Mainnet/Devnet keeps those real chain-read environments separate from `devnet-fixture`.

## Run

From the `kelvara-onre` root:

```bash
./subapps/wallet-inspector/start.sh
```

The launcher stops only prior Wallet Inspector Node processes owned by the current user, starts a fresh background server, waits for `/api/health`, then prints the URL, PID, and log path.

Direct foreground run remains available:

```bash
npm run wallet-inspector
```

Open:

```text
http://127.0.0.1:7620
```

## CLI

The cluster is mandatory; the CLI never guesses mainnet versus devnet.

```bash
npm run wallet-inspector:cli -- <ADDRESS> --cluster mainnet
npm run wallet-inspector:cli -- <ADDRESS> --cluster devnet
```

Machine-readable output:

```bash
npm run wallet-inspector:cli -- <ADDRESS> --cluster mainnet --json
```

Examples:

```bash
npm run wallet-inspector:cli -- 5Y8NV33Vv7WbnLfq3zBcKSdYPrk7g2KoiQoe7M2tcxp5 --cluster mainnet
npm run wallet-inspector:cli -- 11111111111111111111111111111111 --cluster devnet
```

Custom port:

```bash
WALLET_INSPECTOR_PORT=7621 npm run wallet-inspector
```

RPC configuration, in priority order:

```text
HELIUS_RPC_1
HELIUS_RPC_2
SOLANA_RPC_URL
MAINNET_RPC_1
MAINNET_RPC_2
MAINNET_RPC_URL
DEVNET_RPC_1
DEVNET_RPC_2
DEVNET_RPC_URL
```

Without configuration, the subapp uses Solana public mainnet RPC. One provider cannot provide independent dual-source assurance.

## API

```text
GET /api/health
GET /api/inspect/:address?cluster=mainnet
GET /api/inspect/:address?cluster=devnet
```

The inspection endpoint combines existing wallet discovery and current ONRE assurance. A valid wallet without ONYC returns HTTP 200 with an empty `positions` array and `assurance: null`.

## Safety

- Public addresses only.
- No wallet connection.
- No signature.
- No custody.
- Exact ONYC mint matching.
- RPC URLs are not returned to the browser.

## Test

```bash
node --test test/wallet-inspector-subapp.test.js
npm test
npm run check
```
