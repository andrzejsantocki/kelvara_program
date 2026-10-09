# LLM-2 coordination

## Live evidence + bounded retention — 2026-09-28

Owned scope for this implementation:

- `src/platform/storage/**`
- `src/domains/operations/**`
- new focused tests for those directories
- additive operational endpoints in `src/platform/http/{app.js,server.js}` and their focused tests
- additive ingestion-runner metrics/recovery changes under `src/domains/indexer/**` and focused tests
- `docs/live-evidence-retention-plan.md` and related operator documentation

Will not modify Wallet Inspector, Kamino Monitor, Devnet Demo, Rule Studio, Alert Console, shared evidence/event contracts, or producer indexer source. Producer `indexer.db` remains read-only. Work uses strict RED → GREEN → REFACTOR.

Plan: durable deduplicated watch/evidence store; supervised cycle metrics and recovery; tiered telemetry rollups; disk governor; operational APIs; restart/provider-failure/backlog/compaction verification.

Completed:
- Consumer SQLite: WAL, busy timeout, schema version, deduplicated targets/links, immutable idempotent evidence, stable hashes, current state, value-change events, telemetry, incidents, cursors, checkpoint, restart recovery.
- Runner: overlap safety retained; stage/result telemetry, bounded redacted diagnostics, interrupted-cycle recovery, failure incidents, source lag/backlog samples.
- Retention: raw 72h → 1m 7d → 15m 90d → 1h 730d defaults; idempotent atomic tier promotion; canonical evidence/events untouched.
- Disk governor: deterministic 70/80/85 thresholds, forced compaction/pruning hooks, optional-backfill pause, injected disk stats.
- Operations service/API: `/api/operations/status`, `/api/operations/targets`, explicit unknown/null values, optional bearer auth, configurable `HOST`, consumer DB/status paths.
- Scale coverage: 100 clients × 3 positions = 300 distinct positions; multi-target links measured separately; shared target count bounded.
- Shared `package.json` edit: appended new owned source files to `npm run check`; no unrelated script changes.

Verification, exact observed outputs:
- `node --test test/consumer-store.test.js test/retention.test.js test/disk-governor.test.js test/indexer-runner.test.js test/operations-status.test.js test/http-app.test.js` → 17 tests, 17 pass, 0 fail.
- `npm test` → 220 tests, 220 pass, 0 fail.
- `npm run check` → exit 0.

Known limits/blockers:
- Current producer has one `HELIUS_RPC`; no fabricated dual-provider metric. Provider KPI remains unknown without real samples.
- Read-only producer DB fails `quick_check` and `integrity_check`: pages 22145–22158 `never used`; 84,974 signatures, 4,090 pending, newest block time 2026-09-23, stale ~422k seconds, 267,120,640 bytes. Not modified; not healthy/live.
- Stage callback telemetry is emitted but stage is not persisted in the v1 generic telemetry schema.
- Non-loopback deployments must set `KELVARA_OPERATIONS_TOKEN`; enforcement remains an operator configuration requirement.
- No commit or push.

## Mini-app switcher, attributed activity, fee treasury — 2026-09-27

Owned files: `devnet-demo/web/{index.html,app.js,styles.css}`, `devnet-demo/{server.js,solana-chain.js,server.test.js}`.

Implemented:
- Stateful Saturn Earn / Kelvara oval app switcher; Kelvara unlocks only after a confirmed deposit.
- Last Saturn and Kelvara screens persist while switching apps.
- RPC-confirmed wallet activity receives semantic labels only when its signature matches a server-observed operation; unknown transactions remain generic.
- Activity rows show protocol icon, action, amount/fee/evacuation direction, timestamp, short signature, and clickable Explorer action.
- Protection preparation exposes the real public Devnet sandbox-USDC treasury token account and Explorer URL. No signer material is exposed.
- Full suite: 17/17; syntax checks passed. Live demo moved to port 7641 because another developer's Kamino monitor owns 7640.

## Transparent protection terms + full-principal return — 2026-09-27

Owned files extended to `devnet-demo/programs/scenario-capsule/src/{lib.rs,state.rs}` plus the files above.

- Fee transfers from the owner's remaining USDC balance to the real Devnet treasury token account.
- Vault principal remains unchanged; a 750 USDC protected position evacuates 750 USDC.
- Browser signs the disclosed fee-bearing arm transaction; fee is not hidden in a sponsor-only transaction.
- Centered Kelvara pre-sign verification shows full wallet, principal, return amount, 12-month/revocable duration, separate fee, return wallet, treasury, and durable nonce.
- Rules show full trusted/current authority addresses plus plain-language meaning.
- CTA corrected to `Activate protection`.
- Pre-deploy verification: Node 17/17, Rust 6/6, Anchor build passed, JS checks passed.


## Devnet demo portfolio-tab repair — 2026-09-27

Owned files: `devnet-demo/web/{index.html,app.js,styles.css}`, `devnet-demo/server.test.js`.

Plan:
1. Replace the post-deposit modal with a quiet inline Saturn recommendation.
2. Enforce one visible Kelvara panel at a time; keep one canonical discovered position.
3. Rebuild Overview, Positions, Rules, Activity as distinct Web3 portfolio views.
4. Bind deposit, wallet, protection, and live RPC activity state across those views.
5. Verify navigation semantics, responsive layout, and regressions.


## Reserved scope

Phase 1 shared contracts in new, isolated directories:

- `packages/evidence-model/`
- `packages/event-schema/`
- `subapps/contract-inspector/`
- their dedicated tests only

Do not modify Wallet Inspector, discovery, ONRE baseline, current web UI, `package.json`, or `docs/subapps-build-plan.md` while the other developer owns Phase 3.

## Build plan

1. Evidence contract: source, cluster, observed/fetched time, freshness, confidence, coverage, explicit state.
2. Event contract: deterministic ID/dedup key, evidence references, severity, uncertainty, recommended action, mode.
3. Treat `mainnet-beta` and `devnet` as explicit data provenance; never mix evidence across clusters.
4. Add simple shared network profile contract for later UI/API switching, without integrating into files currently being edited.
5. Strict RED → GREEN → REFACTOR tests.
6. Add only a minimal white-mode Contract Inspector UI for human testing; no product-dashboard complexity.

## Completed

- `packages/evidence-model/index.js`: validated, immutable evidence with explicit cluster/provenance/freshness/confidence/coverage/state.
- `packages/evidence-model/network-profile.js`: isolated `mainnet-beta` / `devnet` selection, cluster-specific RPC variables, URL validation, credential redaction.
- `packages/event-schema/index.js`: validated events with deterministic IDs/dedup keys, evidence references, mode/network safety, uncertainty and recommended action.
- `subapps/contract-inspector/`: independently runnable white-mode UI and API for visual contract testing.
- Dedicated tests: 16/16 pass.
- Full repository tests: 68/68 pass on 2026-09-26.
- Syntax checks for all new JavaScript pass.

No existing Wallet Inspector, discovery, ONRE baseline, package scripts, or shared planning checklist files were modified.

## Contract Inspector user test

```bash
cd '/home/andycore/hackaton/[HACKATON]/kelvara-onre'
node subapps/contract-inspector/server.js
```

Open `http://127.0.0.1:4312`. Detailed visual test steps: `subapps/contract-inspector/README.md`.

## Next reserved scope — useful product slice

Phase 4 Rule Studio MVP in new isolated directories:

- `packages/rule-engine/**`
- `subapps/rule-studio/**`

Plan:

1. Build one deterministic declarative evaluator shared by preview/live/history modes.
2. Support equality, threshold, percentage-change, freshness, and source-disagreement operators.
3. Return `pass`, `review`, `breach`, or `unknown`; missing/stale evidence never passes.
4. Build a minimal white Rule Studio UI: Mainnet/Devnet switch, simple form, fixture JSON, plain-language summary, preview result.
5. Reject JavaScript, SQL, shell, and executable expressions.
6. Keep rule storage/version activation and historical replay outside this first MVP.
7. Use strict RED → GREEN → REFACTOR. Do not modify files reserved by the Wallet Inspector developer.

## Rule Studio MVP completed

Built:

- `packages/rule-engine/index.js`
- `packages/rule-engine/rule-engine.test.js`
- `subapps/rule-studio/server.js`
- `subapps/rule-studio/index.html`
- `subapps/rule-studio/styles.css`
- `subapps/rule-studio/app.js`
- `subapps/rule-studio/rule-studio.test.js`
- `subapps/rule-studio/README.md`

Capabilities:

- Deterministic preview with `pass`, `review`, `breach`, `unknown`.
- Equality, greater/less threshold, percentage change, freshness, source disagreement.
- Missing/stale/unavailable/disagreeing evidence cannot pass.
- Rejects unsupported operators and unsafe executable-style fields.
- Mainnet/devnet isolation.
- Minimal white responsive UI with plain-language summary.

Verification:

- Rule Engine + Rule Studio: 8/8 pass.
- New-file syntax checks pass.
- `/api/health` returned active from a real running server.
- Full repository: 78/79 pass. Sole failure is another developer's reserved `subapps/wallet-inspector/start.sh`: test launches it through `sh`, but script requires Bash `pipefail`. Not modified.
- Browser visual automation blocked by Chrome remote-debugging approval; HTTP and integration tests passed.

Run:

```bash
cd '/home/andycore/hackaton/[HACKATON]/kelvara-onre'
node subapps/rule-studio/server.js
```

Open `http://127.0.0.1:7622`. Current test server is running there. Visual test steps: `subapps/rule-studio/README.md`.

## Next reserved scope — bulk CLI and breach simulation

Files remain isolated under:

- `packages/rule-engine/**`
- `subapps/rule-studio/**`

Plan:

1. Add a CLI using the exact shared evaluator: `validate`, `run-batch`, `simulate-breach`.
2. Accept JSON arrays or NDJSON for thousands of rule/evidence cases.
3. Emit machine-readable JSON summaries and optionally complete result JSON.
4. Add deterministic breach fixtures; no network writes or signing.
5. Let CLI simulation publish a run to the local Rule Studio API.
6. Show latest run, counts, status distribution, and sample failures in the white UI.
7. Enforce one cluster per batch and reject cross-network evidence.
8. Add performance/scale test with thousands of evaluations.
9. Strict RED → GREEN → REFACTOR; no Wallet Inspector files.

## Revised Rule Studio model — two levels

### Level 1: Paper

- User or AI CLI defines declarative rules.
- Rules evaluate fixture evidence only.
- CLI mode: `paper`.
- Results are explicitly labelled simulated/paper.

### Level 2: Devnet

- User or AI CLI defines the same declarative rules.
- Evidence comes from a monitoring backend for a real devnet program/account.
- Rule Studio accepts normalized monitored evidence through a bounded API, preserving source, slot/time, freshness, and cluster.
- No fixture fallback. Missing/stale backend state returns `unknown`, never pass.
- CLI mode: `devnet`.
- Same Step 03 result model as Paper.

### Dual operation

- CLI can run/publish Paper and Devnet levels independently or together (`both`).
- UI shows separate Paper and Devnet sections and cannot confuse their outputs.
- Mainnet remains available for paper/batch contracts, but Level 2 is devnet-only.
- No chain writes, signing, or custody.

### Documentation

- Professional operator guide, API contract, CLI examples, evidence schema, trust boundaries, and troubleshooting added in `subapps/rule-studio/README.md`.

## Two-level Rule Studio completed

- Level 1 Paper: fixture evidence, Mainnet/Devnet switch, explicit simulated label.
- Level 2 Devnet: only normalized monitoring-backend evidence with source ID, slot, observed/fetched timestamps, and freshness.
- Both levels use the same rule and Step 03 result model.
- CLI supports `run-levels --paper`, `--devnet`, or both; can publish each level independently to the UI.
- Batch evaluator verified with 5,000 cases; CLI breach simulation exercised with 10,000 cases.
- Rule Studio focused tests: 19/19 pass.
- Full repository tests: 94/94 pass.
- Syntax checks pass.
- Server restarted with the two-level UI at `http://127.0.0.1:7622`.

## Respawn recovery completed

Durable handoff added:

- Root `README.md`: current Rule Studio progress, architecture, usage, CLI/API, verification baseline, and respawn protocol.
- `AGENTS.md`: mandatory startup reading, multi-agent collision safety, invariants, architecture, and test discipline.
- `skills/kelvara-rule-studio/SKILL.md`: operational skill for future LLMs covering Paper/Devnet semantics, commands, schemas, API, procedures, pitfalls, and verification.
- `subapps/rule-studio/README.md`: detailed professional operator reference remains the source for complete usage.

## Next reserved scope — Alert Console MVP

New isolated files only:

- `packages/alert-store/**`
- `subapps/alert-console/**`
- `skills/kelvara-alert-console/**`

Do not modify Protocol Fixture Lab, Wallet Inspector, indexer, shared event/rule packages, or their tests.

Plan:

1. Build deterministic in-memory alert lifecycle store via TDD.
2. Ingest normalized rule results/events through API and CLI.
3. Deduplicate unchanged repeated breaches.
4. Preserve level/mode, evidence IDs, rule version, source, slot/time, severity, uncertainty, and recommended action.
5. Keep Paper, fixture simulation, monitored Devnet, historical, and live modes visibly separate.
6. Support open, acknowledged, resolved, and superseded states.
7. Build minimal independent white UI with filters and evidence details.
8. Add SSE only after lifecycle and dedup tests pass.
9. Add professional README, in-repo skill, and root handoff updates.
10. Run focused and full verification; never fix files reserved by the other LLM.

## Alert Console MVP completed

Built in isolated scope:

- `packages/alert-store/index.js` and lifecycle/dedup tests.
- `subapps/alert-console/server.js`: independent HTTP API, static UI, bounded bodies, SSE.
- `subapps/alert-console/cli.js`: JSON/NDJSON ingest, filter, acknowledge, resolve.
- Minimal responsive white UI with mode/lifecycle filters, counters, evidence detail, explicit human actions.
- Professional operator guide and `skills/kelvara-alert-console/SKILL.md`.
- Root README and AGENTS respawn handoff updated.

Semantics:

- Modes remain distinct: Paper, fixture simulation, monitored Devnet, historical, live.
- Monitored Devnet requires backend source identity and integer slot.
- Repeated active breach increments occurrences.
- Pass resolves matching active alert without creating a green alert.
- New breach after resolution supersedes the old alert and opens a new one.
- Storage is explicitly in memory; restart clears state.

Verification:

- Alert Store + Alert Console focused tests: 11/11 pass.
- Full repository tests: 111/111 pass, including the other LLM's completed Fixture Lab tests.
- JavaScript syntax checks pass.
- In-repo skill frontmatter/length/path checks pass.
- Live `/api/health` and UI HTML checks pass at `http://127.0.0.1:7623`.
- Browser visual automation remains blocked by Chrome's remote-debugging approval; HTTP/UI integration tests cover page content and APIs.

## Next reserved scope — durable monitoring registry

Owned files:

- `packages/rule-registry/**`
- `subapps/alert-console/**`
- `subapps/rule-studio/cli.js` and its dedicated tests/docs only for explicit publishing
- Alert Console/Rule Studio/root respawn documentation

Do not modify Fixture Lab, Wallet Inspector, indexer, shared rule evaluator behavior, or their tests.

Plan:

1. Add SQLite-backed immutable rule versions and durable activation state.
2. Keep Rule Studio as separate authoring/patching server.
3. Publish rules explicitly from Rule Studio CLI to Alert Console; publishing never activates.
4. Let human UI or LLM CLI activate/pause one or many versions.
5. Accept normalized monitoring evidence and evaluate every matching active rule through the shared evaluator.
6. Convert review/breach/pass outcomes into Alert Console lifecycle events with evidence provenance.
7. Restore registry and activation state after Alert Console restart.
8. Keep Paper/fixture/Devnet trust boundaries explicit.
9. Use strict RED → GREEN → REFACTOR and run full verification.

## Durable monitoring registry completed

Delivered:

- `packages/rule-registry/`: SQLite immutable versions, activation, single-active-version safety, audit log, restart recovery.
- Monitoring runner evaluates all active matching Devnet rules through the shared rule engine.
- Alert Console API/CLI: publish/list/activate/pause rules, submit evidence, inspect audit.
- Alert Console UI: select one or many durable rule versions, activate or pause explicitly.
- Rule Studio CLI publishes validated versions to Alert Console; every publish starts paused.
- Root/operator/skill documentation updated with ownership and trust boundaries.

Verification:

- Focused registry, monitoring, Alert Console, and Rule Studio publishing: 23/23 pass.
- Syntax checks pass.
- Full repository: 124/125 pass. Sole failure is the other LLM's actively edited `test/protocol-fixture-lab.test.js` launcher replacement test; reserved Fixture Lab files were not modified.
- Real workflow passed: Rule Studio publish → paused registry → explicit activation → monitored evidence → breach alert.
- Restart check passed: active registry state persisted in SQLite; alert queue cleared exactly as documented.
- Standard Alert Console restarted at `http://127.0.0.1:7623` using `var/alert-console.sqlite`.

Current explicit limit: rule registry/activation/audit are durable; alert instances remain in memory pending a separate persistence phase.

## Next reserved scope — Devnet Scenario Capsule

New isolated root folder only:

- `devnet-demo/**`

Do not modify Fixture Lab, Wallet Inspector, indexer, existing mini-apps, or shared packages during the initial vertical slice.

Objective:

1. Build a real Anchor program deployable to Solana Devnet.
2. Create isolated per-visitor session PDAs with bounded TTL.
3. Support pause, NAV jump, authority-change, and compound scenario flags.
4. Emit on-chain events carrying session, sequence, flags, expiry, and reset fingerprints.
5. Treat expiry as logical baseline restoration; preserve immutable transaction history.
6. Support explicit on-chain reset before expiry.
7. Build a server-sponsored guided demo UI/API only after program behavior passes tests.
8. Never expose sponsor keys or RPC credentials to browsers.
9. Use RED → GREEN → REFACTOR and preserve human control over deployment/signing.

## Devnet Scenario Capsule — implementation checkpoint

Delivered under isolated `devnet-demo/**`:

- Anchor Scenario Capsule program with per-visitor PDA, 30–300 second TTL, pause/NAV/authority flags, compound triggers, events, and explicit reset.
- External program keypair at `~/.config/kelvara/scenario-capsule-keypair.json`; program ID `GGwyWv1goVjyTiH9tQ72uXrn2voF56eZESnM4rEwrY98`.
- Anchor BPF/IDL build succeeded.
- Server-only Anchor client confirms every transaction via Devnet lookup and returns signature, slot, time, PDA, and Explorer links.
- Public API enforces one active session per client, bounded TTL, session ownership, predefined scenarios, and trigger idempotency.
- Guided white demo UI implements start → select → trigger → proof → monitoring → reset.
- Confirmed evidence is normalized as `cluster: devnet`, `source.type: monitoring_backend` and posted to Alert Console active rules.
- Operator README and `skills/kelvara-devnet-demo/SKILL.md` added.

Verified:

- Rust host tests: 4/4 pass.
- Anchor build: pass; `.so`, IDL, and generated type produced.
- Node client/API/monitoring/automatic-reset tests: 10/10 pass.
- Program identity is consistent across keypair, IDL, `declare_id!`, and `Anchor.toml`.
- Full repository suite: 140/141 pass. Sole failure remains the other LLM-owned Fixture Lab launcher replacement test; reserved files were not edited.

Live Devnet completed:

- Program deployed at `GGwyWv1goVjyTiH9tQ72uXrn2voF56eZESnM4rEwrY98`, slot `504428262`; authority `DpbwVS5RYtUon7DVPDHXDSkDKVhxermbYytRP9fGhxXv`.
- Verified real session PDA `BXGuMCg4VevLdzcktt6y7A9jyW3MjhRQR5gNU9Rk3463`.
- Initialize transaction finalized at slot `504429860`.
- Compound trigger finalized at slot `504429872`; three active rule v2 evaluations breached and opened three alerts.
- Reset finalized at slot `504429876`; three rules passed and all three alerts resolved.
- Dedicated durable demo Alert Console runs at `:7624`; guided Devnet demo runs at `:7640`. Port `7623` was left untouched after another LLM replaced its listener.
- Public RPC confirmation timeout after successful submission was reproduced; client now recovers the signature and verifies the confirmed transaction instead of returning a false failure.
- Demo tests: 11/11 pass; syntax checks pass.

### 2026-09-26 — monitoring journey and upfront-fee correction

Scope remained isolated to `devnet-demo/**` plus this coordination note.

- Moved protection testing out of the Kelvara dashboard into distinct Monitor → Incident → Secured stages.
- Added a 5–10 second time-lapse. Day/value growth is explicitly simulated; breach, signatures, evacuation, and balances remain real Devnet state.
- Added a plain-language on-chain change explanation before showing Kelvara's response.
- Added a dedicated resolved-breach page with breach and evacuation Explorer links; wallet balance stays hidden until the user chooses to reveal it.
- Changed program economics: 1% fee transfers from the vault to the authority treasury during `arm_protection`; `position.amount` becomes the remaining protected principal; `evacuate` returns that full amount with no breach-time fee.
- Bound the treasury token account to `session.authority`; removed treasury from evacuation accounts.
- Upgraded `GGwyWv1goVjyTiH9tQ72uXrn2voF56eZESnM4rEwrY98`; upgrade signature `5r1ki2SRidekEk5MvsDhZ9o4V4nttvoNgwqN9SeUNBkB86nbFWi2GL6FTemXrwpUjkA1ofAuMMEQwpA6U3zJ5yNL`.
- Live smoke used a new wallet funded to exactly `0.08 SOL`; verified 750 deposit, 7.5 upfront fee, full 742.5 principal evacuation, final wallet 992.5 USDC.
- Verified Node 13/13, Rust 6/6, Anchor build, syntax checks.

Remaining public-hosting boundary:

- Internet exposure still needs TLS and durable/distributed rate limiting. Current per-client protection is process-local.
- Anchor npm dependency tree reports upstream advisories without available fixes; request bodies remain small and no user TOML parsing is exposed.

## Devnet demo v2 ownership — LLM 2

User-revised flow is reserved under existing `devnet-demo/**` ownership. Do not edit this directory concurrently.

Planned verified journey:

1. Real ephemeral browser keypair and genuine Devnet SOL plus sandbox USDC SPL-token balance.
2. User-signed real SPL-token deposit into Saturn Earn at 7.2% APY.
3. Explicit naked-position interstitial; Kelvara remains absent until user opts in.
4. Kelvara position discovery and protection setup.
5. User signs a durable-nonce evacuation transaction in the docked wallet. Server stores only the signed transaction, never browser secret key material.
6. Real scenario breach followed by relayer submission of that pre-signed transaction; program only permits return to the session owner and fixed fee destination.
7. Professional staged UI replacing the simultaneous three-console screen.

Truth corrections required in current WIP: browser-only token balances, JSON-only permit, 1,000-lamport pseudo-evacuation, and fabricated fallback signatures are not acceptable live Devnet evidence and will be removed.

Completed and verified:

- Scenario Capsule upgraded on Devnet with real SPL deposit, protection, and evacuation instructions. Upgrade signature: `4aeBedCGVY4DaD2ECCp8ohZKRJUtyn5fLjVaD2QciC5cxHnJ6n6MBykYjM51QJf3fzM3XSzRLWd1jaHdXjSaaFD1`.
- Dedicated sandbox-USDC SPL mint: `AXujHvVHXE3G7XcRrmcbhBH63cVk1jCHTnnCiuuQMooE`; mint keypair remains outside the repository.
- Browser wallet genuinely signed the 750 USDC deposit, protection activation, and durable-nonce evacuation permit.
- Real breach caused relayer submission of the pre-signed permit; 742.5 USDC returned and 7.5 USDC fee settled. Final wallet balance verified from token account as 992.5 USDC.
- Live transaction fingerprints are documented in `devnet-demo/README.md`.
- UI replaced simultaneous three-console WIP with staged wallet → Saturn Earn → naked position → Kelvara → exploit journey.
- Node tests: 13/13. Rust tests: 6/6. Anchor build and syntax checks pass.

## Visual-system refinement — 2026-09-27

Ownership remains limited to `devnet-demo/web/**`, the associated product-contract test in `devnet-demo/server.test.js`, and this coordination note.

Implemented:
- Restrained monochrome/lime wallet-shield visual anchor for the burner-wallet hero.
- Connected progress rail with numbered active state and completed checkmarks.
- Unified display/body/eyebrow typography, graphite actions, elevation, and 10–16px component radii.
- Elevated Saturn/Kelvara segmented control with explicit locked-state semantics.
- Responsive step labels and stronger loading-state contrast after desktop/mobile visual review.

Verification: intentional RED product-contract run; focused GREEN; full Node suite `17/17`; `npm run check` passed; JavaScript-disabled desktop/mobile renders reviewed to avoid accidental Devnet funding writes.

## Signer truth, retry recovery, and incident provenance — 2026-09-27

Ownership remains limited to `devnet-demo/web/**`, product-contract coverage in `devnet-demo/server.test.js`, and this coordination note.

Implemented:
- Renamed `Guaranteed return amount` to neutral `Return transaction amount`.
- Kept Kelvara product terms on its review page; wallet drawer now represents a third-party signer and shows only network, transaction count, signer, and the absence of intent metadata.
- Expired protection transactions now offer `Back and regenerate transaction`; `/protection/prepare` creates fresh transaction bytes/blockhash while preserving context.
- Kelvara access persists per burner wallet after first legitimate entry; Restart clears both wallet and access state.
- Incident now shows event time, full transaction hash, and explicit `Team did not announce the authority change.` context.

Verification: focused RED then GREEN; full Node suite `17/17`; `npm run check` passed.

## Position-to-protection funnel optimization — 2026-09-28

Ownership:

- Executable source: `subapps/kamino-monitor/web/{index.html,app.js,styles.css}`.
- Backend transaction/authentication contracts remain in `subapps/kamino-monitor/{server.js,protection.js}`.
- Production static mirror: `/home/andy/COLLOSEUM KELVARA/kelvara-monitor-ui/{index.html,app.js,styles.css}`.
- Funnel contract tests: `test/armed-protection.test.js` and `kelvara-monitor-ui/tests/protection-ux.test.js`.

Implemented:

- Wallet connection performs read-only public-address inspection. It no longer requests authentication or protection status.
- Position view exposes `Arm protection` directly beside optional `Preview monitoring`.
- First click opens one consolidated review. It performs no authentication, network request, or wallet signature.
- Review discloses the three nonce accounts, reclaimable rent, setup fee, exact detected shares/value, wallet and token destination, three fee variants, encrypted storage, no-withdrawal setup semantics, explicit Fast close trigger, automatic monitoring, and revocation semantics.
- `Continue to wallet` requests the off-chain authentication signature, then runs nonce setup and evacuation signing continuously.
- Exact nonce rent is populated from the prepared Mainnet transaction before setup approval. The destination token account is populated from the validated evacuation draft before evacuation signatures.
- Armed protection activates read-only monitoring automatically. Manual Preview/Enable/Activate monitoring remains optional and is no longer an arming prerequisite.

Verification:

- `kelvara_program`: full Node suite `264/264`; focused Kamino/protection suite `55/55`; syntax and `git diff --check` pass.
- Rendered headless Chromium inspection exposed mobile-width, below-fold action, and position-grid overflow defects. RED regressions now enforce a viewport-bounded flex modal, independently scrollable disclosures, persistent action footer, responsive position grid, stacked rows, 44px close target, and no forced minimum width. Re-render at 390×844 confirmed both actions visible, 48px action height, modal width 375px, and no page/modal horizontal overflow.
- `kelvara-monitor-ui`: landing and optimized-funnel contracts `11/11`; syntax and `git diff --check` pass.
- No commit, push, or production deployment performed.

## Local operations console — 2026-09-29

Ownership/scope:

- New independent read-only UI: `subapps/operations-console/{index.html,styles.css,app.js}`.
- Same-origin static delivery through `src/platform/http/app.js` at `/operations/`.
- Contract coverage in `test/operations-console.test.js` and `test/http-app.test.js`.
- The console fetches only `/api/health`, `/api/sources/onre-indexer`, `/api/operations/status`, and `/api/operations/targets`; it never opens or mutates producer/consumer SQLite files.
- Optional bearer token remains browser-memory-only and is never persisted.

Status: completed and running locally.

Verification:

- Focused operations/API/UI suite: 18/18 passing.
- Full repository suite: 268/268 passing.
- `npm run check`: exit 0.
- Live HTTP: `/operations/` returned 200 with `text/html`; all four wrapper APIs returned JSON.
- Firefox rendered the console at `http://127.0.0.1:7610/operations/` with `Live` state and real producer/status values.
- Producer remains read-only and explicitly stale with 4,090 pending records; provider telemetry remains unknown rather than fabricated.

## Local app → operations bridge — 2026-09-29

Ownership/scope:

- Add a bounded, sanitized observation endpoint to `src/platform/http/{app.js,server.js}`.
- Add operations observation validation/storage mapping under `src/domains/operations/**`.
- Instrument Kamino local wallet inspection in `subapps/kamino-monitor/server.js`; no browser secrets, auth tokens, signed transactions, or raw wallet addresses enter operations storage.
- Wire `subapps/kamino-monitor/start-local.sh` to the loopback operations API.
- Add focused integration coverage, then exercise the real local HTTP path and verify `/operations/` changes.

Status: completed and running locally.

Delivered:

- `GET :7650/api/inspect/:wallet` now emits one sanitized observation after successful real Kamino/Solana inspection.
- Wallet identity is stored only as a SHA-256 pseudonymous subject ID; raw wallet, auth data, signed transactions, and secrets are rejected/not emitted.
- `POST :7610/api/operations/observations` validates a strict schema, bounds bodies, persists target/evidence/telemetry, and uses existing bearer protection when configured.
- Local Kamino launcher defaults the bridge to `http://127.0.0.1:7610`; bridge failure never breaks wallet inspection.

Live verification:

- Before inspection: 0 operations targets.
- Real local inspection found 0.646418 Steakhouse USDG shares and active expected ProgramData authority.
- After inspection: 1 Kamino vault target, 1 position link, 1 provider sample, provider state `available`, measured latency ~821 ms.
- `/operations/` remains live at `http://127.0.0.1:7610/operations/`; local app remains live at `http://127.0.0.1:7650/#`.
- Focused bridge/Kamino tests: 38/38 passing.
- Full repository suite: 272/272 passing.
- `npm run check`, `git diff --check`, and launcher shell syntax: pass.

## Program Backend Governance MVP — 2026-10-09

Ownership/scope:

- `subapps/kamino-monitor/governance.js`
- additive governance route wiring in `subapps/kamino-monitor/server.js`
- dedicated `test/governance-api.test.js`
- no changes to Wallet Inspector, Alert Console, Observation Hub storage, or deployment files

Implement authenticated `GET /api/governance` through the existing wallet challenge session. Scope exactly to the authenticated session wallet. Query Observation Hub via scoped authenticated `POST /internal/v1/governance/actions/query`; preserve bounded freshness/partial/stale/unknown responses and exclude secrets/raw bytes. Strict RED → GREEN → REFACTOR.

Status: completed. Focused governance API tests 5/5; full repository 336/336; `npm run check` and `git diff --check` pass. Session scope is one authenticated wallet; multi-wallet enrollment remains a later Control Center expansion. Cursor is opaque pass-through in this MVP because no existing cursor-signing facility is present.

## Monitoring control-plane expansion — 2026-09-29

Ownership/scope:

- Rename generic operations labels around concrete responsibilities: invariant monitoring, protocol indexers, provider observations, evidence storage, wallet monitoring.
- Add protocol-indexer drill-down with ONRE-specific counts/history and an extensible multi-protocol API shape.
- Add provider-labelled hourly continuity history; gaps stay explicit, adverse observations stay visually distinct.
- Replace host-filesystem percentage pruning policy with a persistent admin-configured evidence-storage quota, initially 50 GB.
- Preserve public wallet addresses as client-facing IDs in the operations consumer layer and add wallet detail/history/action APIs. Never store auth tokens, signed transaction bytes, seed/private keys, or RPC credentials.
- Instrument inspection and confirmed/submitted protection actions into the operations API using strict bounded schemas.
- Use strict RED → GREEN → REFACTOR; verify exact API and rendered browser paths.

Status: in progress.
