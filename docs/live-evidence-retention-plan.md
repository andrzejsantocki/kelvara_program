# Live evidence, operational KPIs, and bounded retention

## Goal

Run one continuously supervised polling pipeline that preserves material evidence and operational failures while bounding disk growth. Shared protocol/account targets are observed once and linked to every covered position.

## Non-negotiable invariants

- Producer `indexer.db` remains read-only to Kelvara.
- Mainnet, Devnet, fixture, cached, stale, and unavailable states remain explicit.
- Material evidence/events are never silently removed by telemetry retention.
- RPC/provider failures, missed cycles, restarts, and backlog are first-class observations.
- One target observation may cover many positions; per-client duplicate polling is forbidden.
- SQLite has one controlled writer, WAL mode, bounded indexes, atomic cursors, and restart recovery.

## Phase 1 — Durable consumer store

Build:
- Kelvara-owned SQLite schema for watch targets, position links, current state, immutable evidence, immutable material events, telemetry samples, rollups, cursors, and service incidents.
- Idempotent watch-target and evidence insertion.
- Change-oriented current-state updates: unchanged samples update telemetry/current freshness but do not create duplicate material events.

Pass:
- Two positions sharing one target produce one target and one observation.
- Replaying one evidence ID changes no durable counts.
- A changed value creates one material event linked to evidence.
- Restart restores targets, cursors, current state, evidence, and events.

## Phase 2 — Supervised live ingestion and KPI capture

Build:
- Extend the existing serialized `recent → process → accounts → inspect` cycle.
- Persist cycle start/stage/result and recover interrupted cycles as incidents.
- Record RPC/provider result, latency, timeout/failure, source slot/time, fetch/process times, backlog, and cycle duration.
- Keep freshness, backlog, and availability independent.

Pass:
- Overlap rejected.
- Stage failure stops the cycle and remains visible after restart.
- Three bounded cycles complete without orphan workers.
- Provider failure yields degraded/unavailable evidence, never a healthy result.
- KPI output separates RPC latency, source lag, processing lag, backlog, and uptime.

## Phase 3 — Retention and compaction

Default policy, configurable by environment:
- Raw telemetry: 72 hours.
- One-minute rollups: 7 days.
- Fifteen-minute rollups: 90 days.
- Hourly rollups: 730 days.
- Evidence and material events: retained indefinitely.

Every bucket preserves count, successes, failures, timeouts, minimum/maximum/average latency, maximum source lag, minimum/maximum slot, provider disagreements, and first/last timestamps.

Pass:
- Eligible raw rows compact idempotently.
- Re-running compaction changes no counts.
- Boundary rows remain in the correct tier.
- Material evidence/events survive all retention work.

## Phase 4 — Disk governor

Build:
- Track DB bytes, filesystem free bytes, utilization, compaction lag, last successful compaction, and projected exhaustion where rate data permits.
- Thresholds: warning 70%, force compaction 80%, prune eligible raw telemetry 85%, stop optional backfill before critical exhaustion.
- Never prune canonical evidence/events automatically.

Pass:
- Injected disk states select normal/warning/compact/prune/pause-backfill deterministically.
- Critical state cannot delete canonical records.
- Status API explains the selected action and thresholds.

## Phase 5 — Operator API and HAOS portability

Build:
- `/api/operations/status` for service state, cycle/stage, uptime, backlog, source freshness, provider metrics, storage pressure, and retention state.
- `/api/operations/targets` for deduplicated watch coverage.
- Runtime paths default to local `var/`; HAOS can set all writable paths under `/data`.
- HTTP bind host is configurable; HAOS uses `0.0.0.0`, local development remains `127.0.0.1`.

Pass:
- API returns explicit unavailable/unknown fields instead of fabricated zeroes.
- Restart preserves status history and current durable state.
- Local health/status smoke test passes from a real running process.

## Runtime configuration

- `KELVARA_DB_PATH` — consumer SQLite path; defaults to `./var/kelvara.sqlite` and may point under `/data` on HAOS.
- `KELVARA_INGESTION_STATUS_PATH` — durable runner status; defaults to `./var/ingestion-status.json`.
- `HOST` — HTTP bind; defaults to `127.0.0.1`; HAOS may use `0.0.0.0`.
- `KELVARA_OPERATIONS_TOKEN` — optional bearer token protecting `/api/operations/*`; required operationally when binding non-loopback.
- `KELVARA_RETENTION_RAW_SECONDS`, `KELVARA_RETENTION_1M_SECONDS`, `KELVARA_RETENTION_15M_SECONDS`, `KELVARA_RETENTION_1H_SECONDS` — retention overrides.

Consumer schema uses WAL, `busy_timeout=5000`, foreign keys, `user_version=1`, atomic cursor writes, canonical stable JSON hashes, bounded/redacted diagnostics, and explicit WAL checkpoint support. Evidence and material events are excluded from retention deletion.

## Known deployment blockers

- Producer-specific dual-RPC metrics remain unavailable. The current producer uses one `HELIUS_RPC`; generic provider telemetry records real samples only and APIs return `unknown`/`null` without samples.
- The producer DB is read-only and currently fails both `PRAGMA quick_check` and `PRAGMA integrity_check`: pages 22145–22158 report `never used`. Observed snapshot: 84,974 signatures; 4,090 pending; newest block time 2026-09-23; stale about 422,000 seconds; 267,120,640 bytes. Do not report it healthy/live or repair it from Kelvara.
- Stage is captured by the ingestion runner callback but the current generic telemetry table does not persist the stage dimension. Add a schema migration before stage-level historical KPI reporting.
- Routine retention now runs after every completed ingestion cycle; maintenance outcomes persist separately. Critical disk pressure pauses new optional ingestion cycles. Emergency pruning currently enforces the configured policy rather than shortening canonical retention windows.
- `KELVARA_OPERATIONS_TOKEN` is optional for loopback development. Non-loopback startup now fails closed without it.

## Phase 6 — Scale and failure verification

Exercise:
- Five protocols, 100 clients, three positions each with shared targets.
- Restart during an active cycle.
- One provider timeout and total provider outage.
- Backlog above the configured process limit.
- Repeated compaction and simulated disk pressure.

Pass:
- Target count follows unique monitored objects, not 300 duplicated position polls.
- No duplicate evidence/events.
- No orphan indexer process.
- Failure windows remain queryable.
- Storage remains bounded by policy and canonical evidence remains intact.
