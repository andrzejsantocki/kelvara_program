# Kelvara Protocol Fixture Lab

Fully controllable, deterministic simulator of ONRE's **monitoring-observable surface**.

It is not an ONRE implementation, Solana validator, devnet deployment, or source of real chain evidence. Every response is labeled `fixture-only-not-chain-data` and `fixture_simulation`.

## Why this exists

Use it now to exercise:

```text
scenario → Solana-shaped RPC → existing indexer → normalized evidence → shared rule engine → alerts
```

Later, replace only the fixture producer with a local-validator/Anchor simulator. Keep the RPC, evidence, event, rule, and alert consumer contracts.

## What it models

- Upgrade authority transfer/removal
- Mint authority transfer
- Freeze authority change
- Supply increase
- NAV jump/staleness
- Vault outflow/first-seen destination
- Pause
- Redemption failure
- Multi-condition incident
- Deterministic reset/replay state

## Start

Integrated stack—recommended:

```bash
cd '/home/andycore/hackaton/[HACKATON]/kelvara-onre'
./subapps/protocol-fixture-lab/start-integrated.sh
```

This starts Wallet Inspector (`:7620`), Fixture Lab (`:7630`), and Alert Console (`:7623`) with explicit local wiring.

Fixture Lab only:

```bash
./subapps/protocol-fixture-lab/start.sh
```

UI: `http://127.0.0.1:7630`

Solana JSON-RPC facade: `http://127.0.0.1:7630/rpc`

## CLI

```bash
npm run fixture-lab:cli -- status
npm run fixture-lab:cli -- scenarios
npm run fixture-lab:cli -- trigger upgrade-authority-transfer
npm run fixture-lab:cli -- trigger pause
npm run fixture-lab:cli -- reset
npm run fixture-lab:cli -- export
```

## Web activity view

The always-light UI shows:

- Current simulated ONRE state
- RPC method calls, timestamps, and success/errors
- Fixture transaction slots, scenarios, signatures, and confirmation status
- Automatic refresh every three seconds plus manual refresh

## Control API

```text
GET  /api/health
GET  /api/state
GET  /api/scenarios
GET  /api/activity
GET  /api/export
POST /api/reset
POST /api/scenarios/:name
POST /rpc
```

## Indexer compatibility

Implemented RPC methods required by the current external indexer:

- `getSlot`
- `getSignaturesForAddress`
- `getTransaction` / parsed transaction response
- `getProgramAccounts`
- `getHealth`
- `getVersion`

Configure the external indexer:

```bash
export HELIUS_RPC=http://127.0.0.1:7630/rpc
export PROGRAM_ID=onreuGhHHgVzMWSkj2oQDLDtvvGvoepBPkqyaubFcwe
export INDEXER_DB_PATH=/tmp/onre-fixture-indexer.db
```

Then run its crawl, processing, and account indexing commands.

### Verified integration

A baseline plus `upgrade-authority-transfer` was ingested by the real external indexer:

```text
signatures:   2
processed:    2
instructions: 2
accounts:     2
slots:        1000, 1001
```

External indexer defect discovered: its fresh SQLite schema omits `raw_instructions.program_id`, but its writer requires that column. Full instruction ingestion succeeds after adding that column. The Fixture Lab does not patch or own the external indexer.

The external indexer also has `tsx` installed without its `.bin/tsx` link. Integration was verified by directly executing `node node_modules/tsx/dist/cli.mjs`.

## Evidence and rules

`GET /api/state` returns normalized fixture evidence with:

- `cluster: devnet`
- `source.type: fixture_rpc`
- `mode: fixture_simulation` in fixture state
- slot and deterministic timestamps
- freshness, confidence, coverage
- monitored control values

The `pause` scenario was passed to the shared deterministic rule engine and produced `breach`.

## Safety and limitations

- No signatures, keys, wallet connection, transactions, or chain writes.
- No arbitrary scenario code.
- No claim of real ONRE internal business logic.
- No claim of consensus, runtime, CPI, account locking, rent, compute, or transaction atomicity.
- "99% similar" applies only to the monitoring-observable contract we explicitly model—not protocol execution semantics.
- Mainnet IDs are used as fixture identifiers for compatibility; outputs remain simulation-only.

## Test

```bash
node --test test/protocol-fixture-lab.test.js
npm run check
npm test
```

## Later replacement path

Create a new sibling folder, for example:

```text
subapps/onre-local-validator-lab/
```

Implement the same scenario names and evidence/event contracts using real local-validator transactions. Do not mutate this fixture lab into a program deployment tool; keeping both allows fast deterministic tests plus runtime-realistic integration tests.
