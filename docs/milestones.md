# Build milestones

Each milestone ends with a user-visible or judge-verifiable capability. Infrastructure without a demonstrated product result does not count.

## M1 — Indexer bridge: “The history is real and current enough to use”

Build:

- read-only adapter for the existing ONRE SQLite index;
- schema compatibility check;
- source counts, head slot/signature, pending/failed work;
- truthful `live / stale / unavailable` status;
- health and source-status API.

User value: none exposed yet. This is the evidence foundation preventing fake-live claims.

Judge proof: status endpoint points to real indexed history and reports lag/failures honestly.

Pass: real DB opens read-only; expected schema verified; stale/pending data cannot be called live.

## M2 — Continuous ingestion: “New ONRE activity appears without manual commands”

Build:

- supervised long-running runner around recent-signature discovery, processing, and account snapshots;
- idempotent polling cursor;
- restart recovery;
- measured source-to-SQLite delay;
- process health/watchdog.

User value: monitoring can continue after onboarding.

Judge proof: submit/observe a new ONRE transaction and show its indexed row and measured latency.

Pass: three consecutive transactions ingest once; restart loses no rows; UI says polling until true subscriptions exist.

## M3 — Wallet discovery: “Kelvara finds my ONYC”

Build:

- wallet input/address validation;
- SPL and Token-2022 balance discovery;
- exact ONYC mint match;
- aggregation across wallet-owned token accounts;
- ONRE relationship evidence;
- unsupported-token handling.

User value: paste a public address and receive immediate ONYC position identification—no configuration or wallet connection.

Judge proof: real wallet → correct ONYC balance and attribution; false mint rejected.

Pass: dual-RPC result agrees; raw and normalized balances preserved; p95 normal discovery ≤10s.

## M4 — Current assurance: “What is true about my position now?”

Build:

- ONRE adapter;
- Program → ProgramData → deployment slot/upgrade authority;
- mint/freeze authority and supply;
- NAV and market-price sources kept distinct;
- verified capital accounts only;
- active/degraded/unavailable monitor coverage;
- immutable baseline.

User value: useful day-zero assurance even when no alert exists.

Judge proof: holder sees what was checked, freshness, affected value, and what cannot be proved.

Pass: every green condition maps to evidence; no “safe/all good” claim.

## M5 — Retrospective rules: “How did these checks behave before today?”

Build:

- one rule evaluator shared by live and history;
- historical program upgrades/control changes;
- NAV/price changes and divergence;
- verified capital movements where evidence permits;
- breaches, near-threshold events, closest approach, lookback coverage;
- evidence links.

User value: immediate historical context; the product is valuable without waiting for a future alert.

Judge proof: real ONRE historical event reconstructed from SQLite/RPC evidence.

Pass: replay is reproducible and clearly historical; incomplete history reduces coverage.

## M6 — Live monitor/events: “Tell me when an assumption changes”

Build:

- periodic snapshots/checkpoints;
- deterministic comparisons;
- event deduplication;
- position/value attachment;
- plain-language templates;
- SSE event delivery;
- recommended action.

User value: ongoing detection of code/control, valuation, and supported capital-path changes.

Judge proof: controlled replay or observed event produces one alert with source evidence.

Pass: unchanged state creates no alert; provider outage degrades coverage rather than severity.

## M7 — Lite client: “A nontechnical holder understands it in under a minute”

Build:

- mobile-first wallet journey;
- ONYC position summary;
- current assurance;
- historical rule behavior;
- near-threshold history;
- explicit unknowns;
- one next action;
- Pro evidence links.

User value: complete holder experience without protocol vocabulary.

Judge proof: unfamiliar person explains position/current state/unknowns/action in ≤60s.

Pass: 4/5 comprehension tests; no 360px horizontal scrolling.

## M8 — Pro client: “An analyst can verify every Lite conclusion”

Build, inspired by `CORE/solana-blackbox-monitor-dashboard.html`:

- state/change matrices;
- controlled-account registry;
- instruction/discriminator analytics;
- full slot/time history;
- source/decoder diagnostics;
- filters/API export.

User value: forensic verification and analyst workflow.

Judge proof: Lite conclusion deep-links to exact Pro evidence.

Pass: Lite and Pro reference identical evidence/event IDs and never disagree.

## M9 — Assisted exit: “Help me act without taking custody”

Build:

- verify authoritative ONYC redemption or secondary-sale path;
- build canonical exact transaction;
- simulate exact bytes;
- show asset deltas, fees, slippage, programs, signers, authorities, expiry;
- sign and broadcast separately;
- verify settlement.

User value: response moves from warning to user-approved action.

Judge proof: safe tiny-value/devnet path from alert to verified receipt.

Pass: changed/expired bytes force rebuild and resimulation; unknown effects disable signing.

## M10 — Submission resilience: “The demo survives judging conditions”

Build:

- live HTTPS deployment;
- one-RPC failover;
- visible stale-cache mode;
- historical replay backup;
- clean-install docs/tests;
- pre-existing-work disclosure;
- ≤90-second demo.

User value: reliable access.

Judge proof: core journey succeeds on mobile/poor reception without founder intervention.

Pass: three consecutive rehearsals; backup demo; clean checkout passes.
