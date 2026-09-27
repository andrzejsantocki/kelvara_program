---
name: kelvara-alert-console
description: Operate Kelvara's evidence-linked alert lifecycle.
version: 0.1.0
author: Andrzej Santocki, Hermes Agent
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [Kelvara, Alerts, Solana, Devnet, CLI]
    related_skills: [kelvara-rule-studio]
---

# Kelvara Alert Console Skill

Operate and extend Kelvara's local evidence-linked alert console. Preserve mode provenance, deterministic deduplication, and human-controlled lifecycle transitions.

## When to Use

- Ingest Rule Studio or Fixture Lab outcomes.
- Inspect open, acknowledged, resolved, or superseded alerts.
- Automate Alert Console through its CLI/API.
- Extend deduplication, lifecycle, SSE, or UI behavior.

Do not use it as durable production storage, an authenticated incident system, or proof that synthetic events occurred on-chain.

## Prerequisites

- Node.js 20 or newer.
- Run from repository root.
- Read `README.md`, `AGENTS.md`, `docs/llm-2.md`, every `llm-roles/*.md`, and `subapps/alert-console/README.md`.
- Treat unrelated edits as another LLM's work.

## How to Run

Use `terminal(command="node subapps/alert-console/server.js")`. Open `http://127.0.0.1:7623`.

Verify with `terminal(command="curl http://127.0.0.1:7623/api/health")`.

## Quick Reference

Ingest JSON/NDJSON:

```bash
node subapps/alert-console/cli.js ingest events.ndjson --api http://127.0.0.1:7623
```

List filtered alerts:

```bash
node subapps/alert-console/cli.js list --api http://127.0.0.1:7623 --mode devnet --lifecycle open
```

Acknowledge:

```bash
node subapps/alert-console/cli.js acknowledge '<alert-id>' --api http://127.0.0.1:7623 --actor llm
```

Resolve:

```bash
node subapps/alert-console/cli.js resolve '<alert-id>' --api http://127.0.0.1:7623 --resolution reviewed
```

## Invariants

- Modes are `paper`, `fixture_simulation`, `devnet`, `historical`, or `live`.
- Devnet mode requires monitoring-backend source identity and integer slot.
- Every alert has evidence IDs, rule ID/version, subject, time, severity, uncertainty, and recommended action.
- Dedup identity includes mode and cluster. Simulation and monitored evidence never collapse together.
- Repeated active breach updates occurrence count.
- Pass resolves matching active alert; pass never creates an alert.
- Resolved alert stays immutable except superseded state when a new breach opens.
- Operator acknowledgment/resolution stays explicit.
- Rule versions, activation, and audit are durable in SQLite; alert instances remain memory-only.
- Rule Studio publishes immutable versions; every version starts paused.
- Alert Console UI/CLI activates or pauses one/many versions.
- Only one version per rule ID may be active; activating another version pauses the previous one.
- Normalized monitoring evidence evaluates every matching active rule through the shared evaluator.

## Procedure

1. Read current coordination files and inspect recent changes. Completion: ownership boundaries are known.
2. Record intended Alert Console files in `docs/llm-2.md`. Completion: no overlap with Fixture Lab or Wallet Inspector.
3. Write one failing behavior test. Completion: RED fails for the missing behavior.
4. Implement minimal behavior in `packages/alert-store/` or `subapps/alert-console/`. Completion: focused test is GREEN.
5. Keep event validation and lifecycle in `packages/alert-store/index.js`; do not duplicate it in UI or CLI. Completion: one source of lifecycle truth.
6. Update operator README and root handoff for contract changes. Completion: respawn docs match commands.
7. Run focused, syntax, and full repository verification. Completion: exact results recorded in `docs/llm-2.md`.

## Pitfalls

- A Devnet cluster label does not prove monitored evidence; `mode=devnet`, source type, and slot are required.
- `fixture_simulation` must remain visibly simulated even if Solana-shaped.
- SSE begins with a connection comment; consumers must wait for `event: alert`.
- Alert IDs contain `:` and must be URL-encoded by clients.
- Published state is process-local, not durable.
- Do not touch `subapps/protocol-fixture-lab/**` or Wallet Inspector files without coordination.

## Verification

Use `terminal`:

```bash
node --test packages/alert-store/*.test.js subapps/alert-console/*.test.js
node --check packages/alert-store/index.js
node --check subapps/alert-console/server.js
node --check subapps/alert-console/cli.js
node --check subapps/alert-console/app.js
npm test
```

Start the server, verify `/api/health`, ingest one fixture event twice, then confirm one alert with two occurrences. Do not claim completion from tests alone if the live server cannot start.
