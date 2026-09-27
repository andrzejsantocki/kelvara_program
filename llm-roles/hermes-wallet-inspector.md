# Hermes role — Wallet Inspector

Updated: 2026-09-26

## Ownership

Hermes owns Phase 3 Wallet Inspector until explicitly handed off.

Reserved files:

- `subapps/wallet-inspector/**`
- `test/wallet-inspector-subapp.test.js`
- `test/wallet-discovery.test.js`
- `src/domains/discovery/wallet.js`
- `src/platform/solana/rpc.js`
- `src/domains/protocols/onre/baseline.js` only when required by Wallet Inspector assurance
- Phase 3 checkboxes in `docs/subapps-build-plan.md`

Other agents: do not modify these files without first recording a coordination note in `llm-roles/`.

## Phase log

### Independent animal identicons — 2026-09-27

Owned files: `subapps/kamino-monitor/web/animal-identicon.js`, wallet UI integration, deployment copy rule, focused tests, and this note.

Status: completed and independently reviewed. Standalone versioned module maps validated 32-byte Solana public keys to 12 animals, 12 palettes, 8 backgrounds, and 4 accents; wallet UI consumes it without external requests or raw-key SVG interpolation. Production deploy and local server both include the new ES module. Focused tests pass; full suite 207/207; syntax checks and local HTTP module verification pass. Reviewer found no security or logic blockers.

### Direct header wallet connection — 2026-09-27

Owned files: `subapps/kamino-monitor/web/app.js`, focused UI test, and this note.

Status: completed. When disconnected, the header `Connect wallet` button opens the wallet selector directly. The account menu appears only after a wallet/address exists. Focused test passed; full suite 201/201; syntax checks passed.

### Wallet-connect authentication timing — 2026-09-27

Owned files: `subapps/kamino-monitor/{protection.js,web/app.js}`, focused tests, and this coordination note.

Status: completed. The signed challenge now says `Kelvara wallet authentication` and appears immediately after explicit wallet connection, before position/protection views. UI explains that it proves ownership, moves no funds, and costs no fee. Focused tests 16/16; full suite 200/200; syntax checks passed.

### Phase 7 admin-rule backend — 2026-09-27

Owned files: `subapps/kamino-monitor/server.js`, `test/kamino-monitor.test.js`, and `subapps/kamino-monitor/BACKEND-HANDOFF.md`. Preserve unrelated wallet-selector changes already present in the first two files.

Scope: implement deterministic rules for (1) verifying every relevant admin identity and (2) detecting an admin rollover lacking a matching approved pre-announcement. Add independent control-plane polling and additive API fields; do not modify UI files.

Status: implemented. Focused Kamino suite 31/31, full repository suite 192/192, and `npm run check` pass. Control evidence and rollover incidents are currently process-local; this limitation is explicit in the backend handoff.

### Phase 1 — Repository familiarization

Status: complete.

- Mapped current backend, discovery, ONRE assurance, RPC, indexer, tests.
- Selected Wallet Inspector as smallest useful read-only UI.

### Phase 2 — Subapp design

Status: complete.

- Independent folder: `subapps/wallet-inspector/`.
- Thin backend reusing shared discovery and assurance logic.
- No signing, transaction creation, wallet permissions, or custody.
- Public address inspection first.

### Phase 3A — Initial Wallet Inspector vertical slice

Status: complete.

- Standalone local HTTP server and health endpoint.
- Exact ONYC mint matching.
- SPL Token and Token-2022 discovery.
- ONRE control evidence.
- Empty, invalid, unavailable, and degraded states.
- JSON evidence export.
- Focused tests.

### Phase 3B — Real ONYC holder correction

Status: complete.

Real mainnet input:

- Token account: `9GEMGj45WgCHZ6d7em4K1drmwSjJU3v5CZQ8dLhFnHYM`
- Resolved owner wallet: `E3NiM5n6s5CKKWrrhaeVjVSTKscRrysCtZeXnxn6yMgp`
- Exact ONYC balance observed: `7747479.108350823`
- ONYC mint: `5Y8NV33Vv7WbnLfq3zBcKSdYPrk7g2KoiQoe7M2tcxp5`

Implemented:

- Input accepts either a wallet or token-account address.
- ONYC token account resolves to its owner before owner-account discovery.
- UI explicitly displays `Token to monitor found: ONYC`.
- Position remains visible if secondary ONRE assurance is unavailable.

### Phase 3C — MVP UI and network selection

Status: complete.

- Simplified to minimal white-only UI.
- Added visible Mainnet/Devnet selector.
- API requires explicit `cluster=mainnet|devnet` selection; defaults to mainnet.
- Separate mainnet/devnet RPC configuration.
- Mainnet and devnet evidence must never be mixed.
- Mainnet/Devnet selector is a required convention for every future mini-app.

Verification:

- Real mainnet token-account inspection returned the correct owner, mint, and balance.
- Wallet Inspector focused tests: 15/15 passing.
- Syntax checks passing.
- Mobile screenshot checked: no clipping or horizontal overflow.
- Full repository test suite currently fails in another agent's unfinished scope because `packages/event-schema/event.test.js` imports missing `packages/event-schema/index.js`.

### Phase 3D — Safe local launcher

Status: complete. Launcher is POSIX `sh` compatible. Wallet Inspector recognizes monitored mint inputs and displays curated monitored-token pubkeys.

Added:

- `subapps/wallet-inspector/start.sh`
- Stops only current-user Node processes matching the exact Wallet Inspector server path.
- Starts a fresh background server.
- Writes PID and log under `.runtime/wallet-inspector/`.
- Waits for `/api/health`; fails with the log path if startup fails.

Verification:

- RED confirmed: launcher test initially failed because `start.sh` did not exist.
- GREEN confirmed: restart test passed; old Wallet Inspector exited and replacement health returned HTTP 200.
- Shell syntax passed with `bash -n`.
- Do not work inside `packages/evidence-model/`, `packages/event-schema/`, or `subapps/contract-inspector/`; those belong to LLM-2.

### Phase 3E — ONRE devnet/local-fork placeholder

Status: complete.

- Added visible `ONRE_DEV` placeholder labeled Devnet.
- Purpose preserved: future ONRE devnet local-fork testing.
- No mint/program pubkeys invented before deployment.
- Placeholder is non-clickable and not presented as live evidence.
- Wallet Inspector tests: 10/10 passed; syntax checks passed.

### Phase 3F — Mainnet/Devnet CLI

Status: complete.

Reserved additional files:

- `subapps/wallet-inspector/cli.js`
- `subapps/wallet-inspector/backend/runtime.js`

Delivered:

- Standalone address inspection; HTTP server not required.
- Explicit mandatory `--cluster mainnet|devnet`.
- Shared runtime used by CLI and web server.
- Human-readable output plus `--json`.
- Live mainnet ONYC mint and devnet empty-position invocations passed.
- Focused discovery/CLI/subapp tests: 22/22 passed.
- Syntax checks passed.

### Phase 6A — Protocol Fixture Lab

Status: MVP complete. Launcher race fixed; RPC activity and fixture transaction ledger added.

Reserved scope:

- `subapps/protocol-fixture-lab/**`
- New fixture-lab tests only.

Objective:

- Build a fully controllable, deterministic simulator of ONRE's monitoring-observable behavior.
- Expose Solana JSON-RPC-compatible account and transaction responses so the existing indexer can ingest it by changing only its RPC URL/configuration.
- Keep generated evidence labeled `fixture`/`simulation`; never claim devnet or mainnet execution.
- Preserve the producer boundary so a later local-validator/Anchor implementation can replace this fixture without changing evidence, event, rule, or alert consumers.

Planned first vertical slice:

- Reset baseline.
- Trigger upgrade-authority transfer.
- Emit Solana-shaped signature/transaction/account state.
- Existing indexer ingests the event.
- Shared rule engine produces a deterministic breach.

Delivered:

- Separate `subapps/protocol-fixture-lab` with deterministic reset and 12 controlled scenarios.
- Solana JSON-RPC facade for `getSlot`, `getSignaturesForAddress`, `getTransaction`, and `getProgramAccounts`.
- CLI, control API, POSIX launcher, JSON export, minimal white UI.
- Fixture evidence is explicitly `devnet`, `fixture_rpc`, `fixture_simulation`; never presented as chain data.
- Real external indexer ingested 2 signatures, 2 instructions, and 2 accounts after a temporary compatibility migration.
- External indexer defects documented: missing `raw_instructions.program_id` in fresh schema; missing `.bin/tsx` link.
- Pause scenario produced `breach` through shared rule engine.
- Fixture tests: 6/6 passed; syntax checks passed.
- Full repository suite currently fails in parallel LLM Alert Console SSE test; Fixture Lab focused suite remains green.
- Browser automation blocked by Chrome remote-debugging approval; HTTP/UI assets and behavior contracts are tested.

### Phase 6B — Fixture holder integration

Status: complete.

Canonical environment taxonomy:

- UI network: `devnet-fixture`
- Solana-compatible cluster: `devnet`
- Evidence/event mode: `fixture_simulation`
- Truth label: `fixture-only-not-chain-data`

Scope:

- Add deterministic fixture holder/token-account identities and wallet-compatible RPC methods.
- Route Wallet Inspector Devnet simulation explicitly to Fixture Lab.
- Add one-click fixture-holder inspection and simulation labeling.
- Emit Fixture Lab scenario events into existing Alert Console API without editing Alert Console-owned files.
- Verify holder → scenario → RPC activity → rule breach → alert path.

Delivered and verified:

- Fixture holder `4g7kC6haaE6MzUx428DRdfrgHmwo7Sj5XYAqkx4ys3Rt` with token account `FrnmPoRJ33vJhDd68jCQt7nMiV6gRsrjvTHoM5JtzNzx` and 1,000,000 ONYC.
- Fixture RPC supports `getTokenAccountsByOwner` and parsed/binary `getAccountInfo`.
- Wallet Inspector has `Devnet fixture`, one-click holder selection, and explicit simulation labels.
- Program, ProgramData, and Mint bytes decode through the real ONRE assurance path.
- Scenario control evaluates shared rules and optionally posts valid `fixture_simulation` events to Alert Console.
- Integrated launcher starts Wallet Inspector, Fixture Lab, Alert Console with local wiring.
- End-to-end proof: holder discovered; six RPC calls visible; pause produced breach; one alert created.
- Focused integration suites: 29/29 passed; syntax checks passed.

### Phase 7 — Production Kamino monitor

Status: local production-wallet app uses `http://127.0.0.1:7650/#`; port `7640` is reserved for simulation. Docker artifact retained for later deployment.

Reserved additional scope:

- `subapps/kamino-monitor/**`
- `test/kamino-monitor.test.js`
- production Docker files at repository root

Objective:

- Read-only Mainnet wallet connection/public-address inspection.
- Detect the exact Steakhouse USDG High Yield kVault position.
- Independently decode the kVault ProgramData upgrade authority through Solana RPC.
- Alert visibly when authority differs from the pinned baseline.
- Package as a secret-safe Docker service; no wallet private key enters the container.

Verified identities:

- Vault `BoZDRc1RDY9FzUZZ19WT4GbtTnnbXQ8AGSU5ByEw3ut5`.
- Share mint `4hKmkq2SkthLPceEBJXpyvH9m9PvNpFwasoB8mZgJ6rE`.
- Underlying USDG mint `2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH`.
- kVault program `KvauGMspG5k6rtzrqqn7WNn3oZdyKqLKwK2XWQ8FLjd`.
- ProgramData `GeZ7nkkcbJ6VVV1XVFbmFnLCY3F1LPBGk6cufDZvrbGn`.

Verification:

- Kamino focused suite: 7/7 passing.
- Syntax checks passing, including the production monitor.
- Real Mainnet known-holder inspection found 0.646418 shares and decoded the expected authority from ProgramData.
- Generated disposable wallet correctly returned no position before funding/deposit.
- Docker static contract passed; local Docker runtime unavailable, so image build/run remains for the target server.
- Full repository suite has one unrelated existing `devnet-demo` copy expectation failure.

## Run

```bash
cd '/home/andycore/hackaton/[HACKATON]/kelvara-onre'
npm run wallet-inspector
```

Open `http://127.0.0.1:7620`.

## Coordination protocol

1. Read every file under `llm-roles/` before starting a phase.
2. Record intended files here before editing.
3. Do not edit another agent's reserved files.
4. If shared-file work is unavoidable, stop and leave a coordination note first.
5. Run focused tests for owned scope; report unrelated failures without fixing another agent's in-progress files.
6. Update phase status and verification evidence after each completed phase.
