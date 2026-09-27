# Kelvara ONRE

Kelvara discovers a wallet's ONYC position, monitors the trust assumptions behind it, and prepares a simulated exit for the holder's approval when those assumptions change.

## Product surfaces

- `lite`: nontechnical holder journey. Discovery, current assurance, retrospective rule behavior, near-threshold history, evidence, assisted exit.
- `pro`: analyst surface. Adds raw account matrices, instruction analytics, custom rules, and API export.

Both surfaces consume one evidence model. Pro is deeper—not a different version of truth. Lite is not delayed or intentionally less safe.

## Domain layout

- `src/domains/discovery` — wallet/token discovery and ONYC attribution
- `src/domains/positions` — holder-facing position model
- `src/domains/protocols/onre` — ONRE adapter and evidence registry
- `src/domains/indexer` — read integration with the existing protocol indexer
- `src/domains/monitoring` — baselines, snapshots, rule evaluation
- `src/domains/history` — retrospective breaches and near-threshold events
- `src/domains/events` — normalized events and deterministic explanations
- `src/domains/evacuation` — exact-byte build/simulate/sign/broadcast lifecycle
- `src/domains/editions` — Lite/Pro capability policy
- `src/domains/evidence` — shared provenance/confidence model
- `src/platform` — HTTP, SQLite, RPC, SSE, configuration
- `src/apps/lite-web` — nontechnical client UI
- `src/apps/pro-web` — analyst UI inspired by `CORE/solana-blackbox-monitor-dashboard.html`

## Existing indexer

Initial source:

`/home/andy/kelvara-build/[codebase]/indexer_anchor_protocol/indexer.db`

The app must open it read-only or import incrementally. It must not own or migrate the source DB.

Important: the current indexer is a CLI crawler/processor, not yet an always-on realtime daemon. `--recent` discovers new signatures, then `--process` parses pending transactions. Continuous ingestion needs a supervised loop or a dedicated runner before the UI may call it live.

## Commands

```bash
npm test
npm run check
```

Live CLI progress demo:

```bash
npm run demo -- <public-solana-wallet-address>
```

Or run `npm run demo` and paste a public address at the prompt. “Connect” is read-only address inspection: no seed phrase, browser-wallet permission, signature, or transaction. The CLI uses configured `HELIUS_RPC_1`, `HELIUS_RPC_2`, or `SOLANA_RPC_URL`; without them it uses Solana's public mainnet RPC.

Bounded ingestion and visible status:

```bash
KELVARA_PROCESS_LIMIT=25 npm run ingest:once
npm run ingest:status
```

Each cycle directly launches the local `tsx`, processes at most `KELVARA_PROCESS_LIMIT` pending transactions, and terminates the complete detached process group on timeout (`KELVARA_INDEXER_STEP_TIMEOUT_MS`, default 120 seconds).

Separate Python milestone CLIs:

```bash
python3 -m tools.m1_indexer_inspector
python3 -m tools.m2_ingestion_runner
python3 -m tools.m3_wallet_discovery
python3 -m tools.m4_current_assurance
python3 -m tools.m5_historical_rules
```

M1, M3, M4, and M5 read the Node evidence API at `http://127.0.0.1:7610`; start it with `npm start`. M2 invokes the existing bounded Node ingestion commands. Python remains an orchestration/display layer—it does not duplicate Solana decoding or mutate the producer-owned SQLite database. M5 currently returns exit code 3 and explicitly reports that historical rule evaluation is not implemented.

## Rule Studio — current implemented state

Rule Studio is an independently runnable white-mode mini-app for defining one declarative rule and evaluating it at two strictly separated levels.

### Level 1 — Paper

- Uses fixture evidence.
- Supports Mainnet or Devnet provenance.
- Clearly labelled simulated.
- Suitable for AI-generated rules, bulk tests, regression runs, and breach simulations.

### Level 2 — Devnet

- Uses normalized evidence from a real monitoring backend observing a devnet program or account.
- Requires `cluster=devnet`, monitoring source identity, slot, observed/fetched timestamps, and freshness.
- Never falls back to fixture evidence.
- Missing, stale, unavailable, or disagreeing evidence cannot produce `pass`.

Both levels use the same deterministic evaluator and return `pass`, `review`, `breach`, or `unknown`.

Implemented operators:

- `equals`
- `greater_than`
- `less_than`
- `percent_change_greater_than`
- `freshness_greater_than`
- `source_disagreement`

Arbitrary JavaScript, SQL, shell, and executable rule expressions are rejected. Rule Studio never signs or submits transactions.

### Start Rule Studio

```bash
node subapps/rule-studio/server.js
```

Open `http://127.0.0.1:7622`.

Health check:

```bash
curl http://127.0.0.1:7622/api/health
```

### CLI for an LLM or automation

Validate one rule:

```bash
node subapps/rule-studio/cli.js validate rule.json
```

Run Paper and Devnet inputs together, then publish both summaries to the UI:

```bash
node subapps/rule-studio/cli.js run-levels \
  --paper paper-cases.ndjson \
  --devnet devnet-cases.ndjson \
  --summary-only \
  --publish http://127.0.0.1:7622
```

Either level may run alone by omitting the other argument.

Run 10,000 deterministic synthetic breaches:

```bash
node subapps/rule-studio/cli.js simulate-breach \
  --count 10000 \
  --cluster devnet \
  --summary-only
```

`simulate-breach` is Paper/synthetic even when its fixture provenance says Devnet. It must never be reported as real monitored Devnet activity.

Input may be a JSON array or NDJSON with one `{ "rule": ..., "evidence": ... }` case per line. Machine-readable results go to stdout; machine-readable errors go to stderr. Use `--summary-only` for thousands of rules.

Full operator guide, schemas, API contracts, examples, trust boundaries, and troubleshooting:

`subapps/rule-studio/README.md`

### Rule Studio API

- `GET /api/health`
- `GET /api/levels`
- `POST /api/preview` — Paper evaluation
- `POST /api/levels/devnet/evaluate` — monitored Devnet evaluation
- `POST /api/runs` — publish Paper or Devnet batch summary to the UI

Published runs are process-local and disappear after server restart.

### Rule Studio source map

- `packages/rule-engine/index.js` — validation, evaluator, plain-language summary
- `packages/rule-engine/batch.js` — deterministic bulk evaluation
- `subapps/rule-studio/cli.js` — LLM/automation CLI
- `subapps/rule-studio/server.js` — UI/API server and latest-level state
- `subapps/rule-studio/{index.html,styles.css,app.js}` — white responsive UI
- `subapps/rule-studio/README.md` — professional operator documentation
- `docs/llm-2.md` — implementation and coordination history

### Verification baseline

Last verified after the two-level implementation:

- Rule Engine + Rule Studio focused tests: 19/19 passing.
- Full repository test suite: 94/94 passing.
- Deterministic scale test: 5,000 cases.
- CLI exercise: 10,000 synthetic breach cases.
- New JavaScript syntax checks passing.

Canonical verification:

```bash
node --test packages/rule-engine/*.test.js subapps/rule-studio/*.test.js
npm test
node --check packages/rule-engine/index.js
node --check packages/rule-engine/batch.js
node --check subapps/rule-studio/server.js
node --check subapps/rule-studio/cli.js
node --check subapps/rule-studio/app.js
```

## Alert Console — current implemented state

Alert Console is an independently runnable local queue for evidence-linked rule outcomes.

Capabilities:

- Durable SQLite registry for immutable rule versions, activation state, and audit history.
- Rule Studio publishes versions; Alert Console controls activation.
- UI/CLI can activate or pause one or many rules.
- Active rules evaluate normalized monitoring evidence and create/resolve alerts.
- Publishing never activates; activating a newer version pauses older versions of the same rule.
- Modes remain separate: `paper`, `fixture_simulation`, `devnet`, `historical`, `live`.
- Repeated unchanged breaches deduplicate into one alert with an occurrence count.
- Lifecycle: `open`, `acknowledged`, `resolved`, `superseded`.
- A matching `pass` resolves an active alert without creating a green alert.
- Evidence IDs, rule version, subject, severity, uncertainty, source, slot, and timestamps remain attached.
- SSE pushes lifecycle changes to the minimal white UI.
- CLI accepts JSON arrays or NDJSON for LLM automation.

Start:

```bash
node subapps/alert-console/server.js
```

Open `http://127.0.0.1:7623`.

CLI examples:

```bash
node subapps/alert-console/cli.js ingest events.ndjson --api http://127.0.0.1:7623
node subapps/alert-console/cli.js list --api http://127.0.0.1:7623 --mode devnet --lifecycle open
node subapps/alert-console/cli.js acknowledge '<alert-id>' --api http://127.0.0.1:7623 --actor llm
node subapps/alert-console/cli.js resolve '<alert-id>' --api http://127.0.0.1:7623 --resolution reviewed
```

Monitoring rule versions, activation state, and audit history are durable in SQLite (`var/alert-console.sqlite`). Alert instances remain process-local and clear on restart. No authentication, external notifications, or autonomous polling daemon yet.

Full guide: `subapps/alert-console/README.md`.
Agent skill: `skills/kelvara-alert-console/SKILL.md`.

## LLM respawn protocol

Before modifying this repository:

1. Read `README.md`.
2. Read every file under `llm-roles/`.
3. Read `docs/llm-2.md`.
4. Read `skills/kelvara-rule-studio/SKILL.md` before Rule Studio work.
5. Treat unexpected edits as another developer's work; never overwrite or revert them.
6. Record intended scope in the relevant coordination file before implementation.
7. Keep Mainnet and Devnet evidence separate.
8. Preserve the Paper versus monitored-Devnet distinction.
9. Use RED → GREEN → REFACTOR.
10. Run focused tests, then `npm test`; report the exact observed results.

## Build discipline

Every behavior uses RED → GREEN → REFACTOR. Current work begins with architecture contracts and freshness truthfulness before wallet discovery.
