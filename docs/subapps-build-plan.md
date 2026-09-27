# Kelvara Atomic Subapps Build Plan

> **Guideline for Hermes:** Use this document as the implementation contract. Work phase-by-phase. Follow RED → GREEN → REFACTOR. Mark `[x]` only after the stated verification passes. Do not silently broaden scope, duplicate shared logic, or claim unavailable evidence as healthy.

**Goal:** Give the human independent local control over every major Kelvara capability while preserving one deterministic evidence and rule model.

**Architecture:** Kelvara consists of independently runnable local subapps backed by shared packages. Each subapp has a narrow responsibility, CLI/API access, local web UI, explicit health/freshness state, and independent lifecycle. Shared decoding, evidence, events, and rule evaluation stay in packages rather than being copied into subapps.

**Tech stack:** Node.js 20+, TypeScript, SQLite, HTTP/SSE, Solana RPC, Anchor/Rust for the devnet lab, browser-local web interfaces.

---

## 1. Non-negotiable architecture rules

- [ ] Every subapp can start, stop, test, and run independently.
- [ ] Every subapp has a documented local command and fixed/configurable port.
- [ ] Every subapp exposes `/api/health`.
- [ ] Every data-bearing response identifies source, observed time, freshness, and confidence.
- [ ] Every subapp has a CLI or API path; the UI is never the only control surface.
- [ ] Shared Solana decoding lives in shared packages.
- [ ] Shared evidence semantics live in `packages/evidence-model`.
- [ ] Shared event semantics live in `packages/event-schema`.
- [ ] One deterministic rule engine powers live evaluation, historical replay, previews, devnet scenarios, and tests.
- [ ] No subapp embeds arbitrary executable user rules.
- [ ] No UI labels cached, stale, or replayed data as live.
- [ ] No missing evidence produces a green/healthy conclusion.
- [ ] No signing is required for public wallet inspection.
- [ ] No secret, private key, seed phrase, Ledger PIN, pairing URI, or RPC credential is logged.
- [ ] Transaction simulation and signing use identical reviewed message bytes.
- [ ] Blockhash expiry requires rebuild, resimulation, and a new approval.
- [ ] Existing producer-owned indexer databases remain read-only unless the indexer itself owns the write.
- [ ] Every milestone ends with a demonstrable vertical slice, not only internal code.

## 2. Target structure

```text
kelvara-onre/
├── packages/
│   ├── evidence-model/
│   ├── event-schema/
│   ├── solana-rpc/
│   ├── onre-adapter/
│   └── rule-engine/
├── subapps/
│   ├── indexer-console/
│   │   ├── backend/
│   │   └── web/
│   ├── wallet-inspector/
│   │   ├── backend/
│   │   └── web/
│   ├── rule-studio/
│   │   ├── backend/
│   │   └── web/
│   ├── alert-console/
│   │   ├── backend/
│   │   └── web/
│   └── onre-devnet-lab/
│       ├── program/
│       ├── scenarios/
│       └── web/
├── launcher/
│   └── kelvara-local
└── docs/
    └── subapps-build-plan.md
```

## 3. Definition of atomic control

A component has atomic human control only when all checks pass:

- [ ] It can be launched alone.
- [ ] It can be stopped alone.
- [ ] Its configuration is inspectable before launch.
- [ ] Its current state is visible without reading logs.
- [ ] Its operation can be triggered manually.
- [ ] Its operation can be tested against a fixture.
- [ ] Its failures are explicit and actionable.
- [ ] Its outputs can be exported as JSON.
- [ ] Its inputs can be replayed from JSON fixtures where applicable.
- [ ] It does not require unrelated subapps merely to display its own health.
- [ ] It does not mutate another component’s data without an explicit contract.

---

## Phase 0 — Repository safety and baseline

**Goal:** Establish safe, reproducible development before restructuring.

- [ ] Initialize Git in `kelvara-onre` if still absent.
- [ ] Add `.gitignore` for `.env`, credentials, `node_modules`, Python caches, SQLite WAL/SHM, runtime status, generated output, Anchor targets, and keypairs.
- [ ] Record current test baseline: Node 43/43, Python 7/7, syntax checks passing.
- [ ] Correct the default indexer path from `/home/andy/...` to configuration appropriate for `/home/andycore/...`.
- [ ] Prefer environment/config discovery over user-specific hardcoding.
- [ ] Add configuration validation that never prints RPC secrets.
- [ ] Audit existing `.env` files under `/home/andycore/hackaton/[codebase]`.
- [ ] Rotate credentials if any may have been copied, committed, or exposed.
- [ ] Choose one canonical ONRE source checkout.
- [ ] Choose one canonical ONRE documentation corpus.
- [ ] Document all reused pre-hackathon components and licenses.
- [ ] Save a clean baseline commit before moving files.

### Phase 0 verification

- [ ] `npm test` passes.
- [ ] `npm run check` passes.
- [ ] `python3 -m unittest discover -s tools/tests -v` passes.
- [ ] `npm run ingest:status` resolves the configured local DB.
- [ ] `git status --short` contains no secret/runtime artifacts.
- [ ] Canonical ONRE source and docs paths are recorded.

---

## Phase 1 — Shared contracts and packages

**Goal:** Extract shared truth before adding more user interfaces.

### 1.1 Evidence model

Create `packages/evidence-model`.

- [ ] Define evidence classes: `verified_onchain`, `doc_declared`, `third_party`, `model_estimated`, `external_unknown`.
- [ ] Define source identity, observed time, fetched time, slot/block time, freshness, confidence, and coverage.
- [ ] Define explicit states: `active`, `degraded`, `unavailable`, `stale`, `disagreement`.
- [ ] Prevent `unavailable`, `stale`, or `disagreement` evidence from producing a healthy conclusion.
- [ ] Add JSON serialization and schema validation.
- [ ] Add tests for stale, missing, disagreeing, and partial evidence.

### 1.2 Event schema

Create `packages/event-schema`.

- [ ] Define normalized event identity and deduplication key.
- [ ] Define event types for program control, token control, valuation, capital movement, rule breach, near-threshold, and exit lifecycle.
- [ ] Include affected position, affected value, evidence references, severity, uncertainty, and recommended action.
- [ ] Distinguish `live`, `historical`, `historical_replay`, and `fixture_simulation`.
- [ ] Add schema validation and round-trip tests.

### 1.3 Solana RPC package

Create `packages/solana-rpc` from existing RPC code.

- [ ] Support named primary and secondary providers.
- [ ] Require two or more agreeing independent providers before labeling state `verified`.
- [ ] Label one successful provider `single_source`, not `verified`.
- [ ] Preserve raw account bytes and slot metadata.
- [ ] Redact provider URLs and credentials from errors.
- [ ] Add timeout, retry, and provider health reporting.
- [ ] Add deterministic mocked RPC tests.

### 1.4 ONRE adapter

Create `packages/onre-adapter` from current discovery/baseline logic.

- [ ] Decode ONRE program and ProgramData independently of IDL.
- [ ] Decode ONYC mint authority, freeze authority, decimals, and supply.
- [ ] Match exact ONYC mint through a curated registry.
- [ ] Define verified ONRE capital accounts only when evidence supports them.
- [ ] Define adapter capabilities and unavailable reasons.
- [ ] Keep NAV, market price, and capital movement as separate evidence dimensions.
- [ ] Add fixture tests for valid, malformed, missing, and changed state.

### 1.5 Deterministic rule engine

Create `packages/rule-engine`.

- [ ] Define versioned declarative rule schema.
- [ ] Support operators: equality, change, percentage change, threshold, freshness, first-seen destination, source disagreement.
- [ ] Support observation windows and cooldown/deduplication.
- [ ] Produce `pass`, `review`, `breach`, or `unknown`.
- [ ] Preserve evidence references in every result.
- [ ] Use the same evaluation function for live, historical, preview, and simulation modes.
- [ ] Add near-threshold classification without mislabeling it as a breach.
- [ ] Reject malformed or unsupported rules.
- [ ] Add deterministic clock injection.
- [ ] Add comprehensive unit and golden-fixture tests.

### Phase 1 verification

- [ ] Existing discovery and baseline tests pass through shared packages.
- [ ] Two RPC sources are required for `verified`.
- [ ] Identical evidence produces identical rule output in all modes.
- [ ] Missing evidence produces `unknown`, never `pass`.
- [ ] Shared packages have no dependency on any UI.

---

## Phase 2 — Indexer Console

**Goal:** Let the human operate and inspect the real local transaction indexer through a local UI and CLI.

Create `subapps/indexer-console`.

### Backend controls

- [ ] Configure indexer directory, DB path, status path, polling interval, timeout, and per-cycle process limit.
- [ ] Expose source schema compatibility.
- [ ] Expose current freshness, newest indexed block time, pending count, processed count, and failed count.
- [ ] Expose current runner state, stage, cycle number, latency, and last error.
- [ ] Add manual `run one cycle` operation.
- [ ] Add explicit start/stop continuous polling operations.
- [ ] Prevent overlapping cycles.
- [ ] Add bounded retry for failed transactions.
- [ ] Add read-only transaction/instruction/account queries.
- [ ] Add SSE progress stream.
- [ ] Persist operational state without confusing it with source-of-truth index data.

### Local web UI

- [ ] Show clear `live`, `stale`, `unavailable`, and `incompatible` states.
- [ ] Show Start, Stop, and Run Once controls.
- [ ] Show pipeline stages: recent → process → accounts.
- [ ] Show pending/processed/failed counters.
- [ ] Show current and previous cycle timings.
- [ ] Show recent decoded transactions.
- [ ] Show failed items with actionable reason.
- [ ] Show source DB path and schema version.
- [ ] Show each RPC provider health without exposing credentials.
- [ ] Allow JSON export of a transaction evidence bundle.

### CLI

- [ ] `status`
- [ ] `run-once`
- [ ] `start`
- [ ] `stop`
- [ ] `inspect-transaction <signature>`
- [ ] `retry <signature>`

### Phase 2 verification

- [ ] Console runs alone.
- [ ] UI controls a real local ingestion cycle.
- [ ] A newly discovered transaction becomes visible in the UI.
- [ ] Process restart preserves truthful status.
- [ ] Stale source is visibly stale.
- [ ] Read-only inspection cannot mutate the producer DB schema.
- [ ] Failure and timeout paths are tested.

---

## Phase 3 — Wallet Inspector

**Goal:** Let the human inspect any public wallet and determine whether it holds exactly monitored assets and positions.

Create `subapps/wallet-inspector`.

### Backend

- [x] Validate a Solana public address before network work.
- [x] Fetch SPL Token and Token-2022 accounts.
- [x] Aggregate multiple token accounts for the same monitored mint.
- [x] Match exact monitored mints from a curated registry.
- [x] Return raw amount, decimals, normalized amount, and token accounts.
- [x] Return protocol relationship and supporting evidence.
- [x] Return provider agreement/degradation.
- [x] Return available, degraded, and unavailable monitor capabilities.
- [x] Never infer economic protocol ownership from SPL Token Program ownership.
- [ ] Support registry listing and exact-mint search.

### Local web UI

- [x] Public wallet input; no wallet connection required.
- [x] List exact monitored-token matches first.
- [x] Show raw and normalized balances.
- [x] Show protocol attribution and confidence.
- [x] Show evidence source and freshness.
- [x] Show active/degraded/unavailable monitor coverage.
- [ ] Show unknown tokens without inventing protocol attribution.
- [x] Export wallet evidence as JSON.

### CLI

- [ ] `inspect-wallet <address>`
- [ ] `list-monitored-assets`
- [ ] `inspect-mint <mint>`

### Phase 3 verification

- [ ] Known ONYC wallet is identified by exact mint.
- [x] Wallet with no ONYC returns a truthful empty supported-position result.
- [x] Invalid wallet fails before RPC calls.
- [x] Token-2022 and standard SPL accounts are both covered.
- [x] Multiple token accounts aggregate without precision loss.
- [x] One-provider operation is labeled `single_source` or degraded.
- [x] UI runs independently of Rule Studio and Alert Console.

---

## Phase 4 — Rule Studio

**Goal:** Give the human explicit, inspectable control over deterministic monitoring rules.

Create `subapps/rule-studio`.

### Rule model

- [ ] Rule ID and version.
- [ ] Human-readable name and purpose.
- [ ] Evidence input type.
- [ ] Operator and threshold.
- [ ] Time window.
- [ ] Near-threshold boundary.
- [ ] Severity.
- [ ] Recommended action.
- [ ] Required evidence/freshness policy.
- [ ] Enabled/disabled state.
- [ ] Creation/update metadata.

### Backend

- [ ] Validate rule definitions through `packages/rule-engine`.
- [ ] Store versioned rules in local SQLite.
- [ ] Never overwrite historical versions.
- [ ] Preview a rule against a fixture.
- [ ] Replay a rule over indexed historical observations.
- [ ] Compare current draft with active version.
- [ ] Activate, disable, clone, export, and import rules.
- [ ] Reject arbitrary JavaScript, SQL, shell commands, or code expressions.
- [ ] Record an audit event for every activation/change.

### Local web UI

- [ ] Guided form for supported operators.
- [ ] Plain-language rule summary before activation.
- [ ] Evidence availability warning.
- [ ] Fixture preview with exact input/output.
- [ ] Historical breach and near-threshold results.
- [ ] Draft/active version comparison.
- [ ] Activate/disable controls with confirmation.
- [ ] JSON/YAML export/import.

### CLI

- [ ] `list-rules`
- [ ] `validate <file>`
- [ ] `preview <rule> <fixture>`
- [ ] `replay <rule> <range>`
- [ ] `activate <version>`
- [ ] `disable <rule-id>`

### Phase 4 verification

- [ ] Preview, replay, and live evaluation return identical results for identical evidence.
- [ ] Invalid rule cannot activate.
- [ ] Rule history remains immutable.
- [ ] Missing required evidence returns `unknown`.
- [ ] Rule configuration requires no source-code editing.
- [ ] UI runs independently with fixture data when the indexer is offline.

---

## Phase 5 — Alert Console

**Goal:** Turn normalized evidence and rule results into inspectable, deduplicated alerts.

Create `subapps/alert-console`.

### Backend

- [ ] Consume normalized observations/events.
- [ ] Evaluate active rules through the shared rule engine.
- [ ] Deduplicate repeated evaluations.
- [ ] Preserve event lifecycle: open, acknowledged, resolved, superseded.
- [ ] Keep historical replay and devnet simulation clearly separated from live events.
- [ ] Store evidence references and complete rule version.
- [ ] Link alert to affected wallet, position quantity, and available valuation.
- [ ] Provide SSE updates.
- [ ] Support deterministic reprocessing.

### Local web UI

- [ ] Current status by monitored position.
- [ ] Open alerts ordered by severity/time.
- [ ] Historical breaches and near-threshold events.
- [ ] Evidence drawer with source, slot/signature, freshness, and confidence.
- [ ] Plain-language explanation.
- [ ] Explicit uncertainty and unavailable evidence.
- [ ] Recommended action.
- [ ] Acknowledge and resolve controls.
- [ ] Filter by `live`, `historical`, `historical_replay`, and `fixture_simulation`.

### Phase 5 verification

- [ ] One evidence change creates one alert, not duplicates.
- [ ] Repeated unchanged evidence does not create new alerts.
- [ ] Resolution is recorded when condition clears.
- [ ] Historical replay cannot appear in the live queue.
- [ ] Alert evidence is reproducible from stored inputs.
- [ ] UI runs independently against fixture events.

---

## Phase 6 — Simplified ONRE Devnet Lab

**Goal:** Provide a controlled Solana devnet protocol specifically for producing reproducible trust-breaking conditions. It is a simulation model, not a claim of full ONRE equivalence.

Create `subapps/onre-devnet-lab`.

### Scope contract

- [ ] Document which ONRE concepts are modeled.
- [ ] Document which ONRE concepts are intentionally omitted.
- [ ] Label all generated events `fixture_simulation`.
- [ ] Never present the program as official ONRE code.
- [ ] Use isolated devnet program IDs and test assets.
- [ ] Keep test authorities separate from mainnet wallets.

### Minimal program state

- [ ] Config/state PDA.
- [ ] Admin authority.
- [ ] Upgrade authority visibility.
- [ ] Test token mint.
- [ ] Mint/freeze authority state.
- [ ] Reported NAV field with update timestamp.
- [ ] Vault token account.
- [ ] Pause/kill-switch state.
- [ ] Simplified redemption queue or exit state.

### Controlled scenarios

- [ ] Program upgrade/version change.
- [ ] Upgrade-authority transfer.
- [ ] Upgrade authority removal/immutability.
- [ ] Mint-authority transfer.
- [ ] Freeze-authority change.
- [ ] Unexpected supply increase.
- [ ] NAV jump.
- [ ] NAV staleness.
- [ ] Vault outflow to known destination.
- [ ] Vault outflow to first-seen destination.
- [ ] Pause/kill-switch activation.
- [ ] Redemption delay/failure.
- [ ] Multi-condition incident.
- [ ] Deterministic reset to baseline.

### Scenario runner and UI

- [ ] Deploy/reset local or devnet lab.
- [ ] Show current simulated protocol state.
- [ ] Trigger one named scenario explicitly.
- [ ] Show expected state delta before execution.
- [ ] Require confirmation for state-changing operations.
- [ ] Display resulting signature and account changes.
- [ ] Feed resulting real devnet evidence through Indexer Console and Alert Console.
- [ ] Export scenario definition and expected alerts.

### Phase 6 verification

- [ ] Fresh deployment establishes a known baseline.
- [ ] Every scenario has a deterministic test.
- [ ] Every state-changing scenario produces an actual devnet transaction.
- [ ] Indexer observes the transaction.
- [ ] Shared rule engine produces the expected result.
- [ ] Alert Console labels it as `fixture_simulation`.
- [ ] Reset restores the baseline.
- [ ] No scenario touches mainnet accounts or assets.

---

## Phase 7 — Unified local launcher

**Goal:** Preserve atomic operation while offering convenient whole-system startup.

Create `launcher/kelvara-local`.

- [ ] `list` available subapps.
- [ ] `start <subapp>` starts one component.
- [ ] `stop <subapp>` stops one component.
- [ ] `restart <subapp>` restarts one component.
- [ ] `status <subapp|all>` reports health and ports.
- [ ] `start-all` starts the local stack in dependency order.
- [ ] `stop-all` stops the stack cleanly.
- [ ] Detect port conflicts before startup.
- [ ] Keep process IDs/state in a runtime directory excluded from Git.
- [ ] Show log paths without requiring log reading for basic status.
- [ ] Do not use Docker as a mandatory dependency.
- [ ] Optional Docker Compose may be added only after native local commands work.

### Phase 7 verification

- [ ] Every subapp still runs alone.
- [ ] `start-all` reaches healthy state.
- [ ] Stopping one optional UI does not stop indexer ingestion.
- [ ] Restarting a UI does not lose backend/index data.
- [ ] Launcher detects failed health checks and reports actionable errors.

---

## Phase 8 — End-to-end acceptance journeys

### Journey A: Operate the live local indexer

- [ ] Start only Indexer Console.
- [ ] Confirm configured DB and RPC providers.
- [ ] Run one bounded ingestion cycle.
- [ ] Observe stage progress.
- [ ] Inspect a real indexed transaction.
- [ ] Export its evidence bundle.

### Journey B: Inspect any wallet

- [ ] Start only Wallet Inspector.
- [ ] Enter a public wallet.
- [ ] See exact monitored token matches.
- [ ] Inspect ONYC relationship evidence.
- [ ] See active/degraded/unavailable capabilities.
- [ ] Export the wallet evidence.

### Journey C: Configure and test a rule

- [ ] Start Rule Studio with fixture data.
- [ ] Create a program-control rule.
- [ ] Validate it.
- [ ] Preview it against pass and breach fixtures.
- [ ] Replay it over historical data.
- [ ] Activate a version.
- [ ] Verify immutable history and audit record.

### Journey D: Simulate a breaking condition

- [ ] Deploy/reset ONRE Devnet Lab.
- [ ] Establish baseline.
- [ ] Trigger an upgrade-authority change or vault outflow.
- [ ] Observe the real devnet transaction in Indexer Console.
- [ ] Observe the deterministic rule result.
- [ ] Observe one evidence-linked simulated alert.
- [ ] Reset the lab.

### Journey E: Full local stack

- [ ] Start all subapps through the launcher.
- [ ] Inspect a wallet holding the test asset.
- [ ] Confirm baseline and rule coverage.
- [ ] Trigger a devnet condition.
- [ ] Observe ingestion, evaluation, and alert propagation.
- [ ] Confirm event mode, evidence, freshness, and recommended action.
- [ ] Stop each component independently.

---

## 9. Required testing discipline

For every behavior:

- [ ] Write one failing test.
- [ ] Run it and confirm the expected failure.
- [ ] Implement the minimum passing behavior.
- [ ] Run the targeted test.
- [ ] Run the subapp/package suite.
- [ ] Run the complete repository suite.
- [ ] Refactor only while green.
- [ ] Exercise the behavior through CLI/API.
- [ ] Exercise UI behavior in a real browser when applicable.
- [ ] Commit only the verified milestone files.

Required test layers:

- [ ] Unit tests for pure decoding and evaluation.
- [ ] Contract tests for shared schemas.
- [ ] Integration tests with temporary SQLite databases.
- [ ] Mocked RPC failure/disagreement tests.
- [ ] Golden fixtures for historical and devnet events.
- [ ] Browser tests for critical local UI journeys.
- [ ] End-to-end devnet test for each breaking scenario.
- [ ] Security tests for path handling, secret redaction, unsafe rule input, and transaction intent.

---

## 10. Explicit anti-goals

- [ ] Do not create microservices merely for architectural appearance.
- [ ] Do not duplicate the rule evaluator per UI.
- [ ] Do not duplicate ONRE decoding per subapp.
- [ ] Do not introduce Kafka, Kubernetes, Redis, or a private indexer without a demonstrated blocker.
- [ ] Do not add generic multi-protocol support before the ONRE vertical slice works.
- [ ] Do not add unattended evacuation.
- [ ] Do not allow arbitrary code in rules.
- [ ] Do not claim real-time when using polling.
- [ ] Do not claim protocol semantics from token ownership alone.
- [ ] Do not call market price NAV.
- [ ] Do not call unusual movement theft.
- [ ] Do not present historical/devnet events as live incidents.
- [ ] Do not make Docker mandatory for local human control.
- [ ] Do not couple all subapps into one process.
- [ ] Do not let independently runnable become independently inconsistent.

---

## 11. Build order

- [ ] 0. Repository safety and baseline.
- [ ] 1. Shared evidence, event, RPC, ONRE, and rule packages.
- [ ] 2. Indexer Console.
- [ ] 3. Wallet Inspector.
- [ ] 4. Rule Studio.
- [ ] 5. Alert Console.
- [ ] 6. Simplified ONRE Devnet Lab.
- [ ] 7. Unified local launcher.
- [ ] 8. End-to-end acceptance journeys.

Do not skip directly to the Devnet Lab UI before the evidence and rule contracts exist. The lab must test the same system used by live and historical monitoring.

## 12. Overall definition of done

- [ ] Human can operate the local indexer without editing source code.
- [ ] Human can inspect any public wallet without signing.
- [ ] Human can see exact monitored-token matches and evidence.
- [ ] Human can create, preview, replay, version, activate, and disable safe declarative rules.
- [ ] Human can inspect live, historical, and simulated alerts separately.
- [ ] Human can deploy/reset a simplified ONRE devnet lab.
- [ ] Human can trigger reproducible breaking conditions.
- [ ] Real devnet transactions flow through the same indexer, evidence, rule, and alert path.
- [ ] Every subapp runs independently.
- [ ] Whole stack can also run through one launcher.
- [ ] Missing/stale/disagreeing evidence remains explicit.
- [ ] Automated tests and browser verification prove all core journeys.
- [ ] Documentation lists commands, ports, data ownership, dependencies, and limitations for every subapp.
