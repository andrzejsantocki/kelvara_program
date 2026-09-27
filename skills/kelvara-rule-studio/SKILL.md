---
name: kelvara-rule-studio
description: Operate and extend Kelvara's two-level rule system.
version: 0.1.0
author: Andrzej Santocki, Hermes Agent
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [Kelvara, Rules, Solana, Devnet, CLI]
    related_skills: []
---

# Kelvara Rule Studio Skill

Operate, test, and extend Kelvara's deterministic rule system. Preserve the strict boundary between Paper simulation and real monitored Devnet evidence.

## When to Use

- Running Rule Studio locally.
- Generating or validating rules through an LLM.
- Evaluating thousands of rule/evidence cases.
- Publishing batch outcomes to the Rule Studio UI.
- Connecting a Devnet monitoring backend.
- Extending operators, APIs, CLI commands, or the two-level UI.

Do not use this skill to sign transactions, modify chain state, or present synthetic evidence as observed Devnet activity.

## Prerequisites

- Run commands from the repository root.
- Node.js 20 or newer.
- Read `README.md`, `AGENTS.md`, `docs/llm-2.md`, and every file under `llm-roles/` first.
- Treat unrelated edits as another developer's work.

## Mental Model

### Level 1: Paper

- Input: fixture evidence.
- Network provenance: `mainnet-beta` or `devnet`.
- Trust label: simulated.
- Uses: rule design, regression tests, bulk simulations, demonstrations.

### Level 2: Devnet

- Input: normalized evidence from a real monitoring backend.
- Network: `devnet` only.
- Required provenance: `source.id`, `source.type=monitoring_backend`, integer `slot`, `observedAt`, `fetchedAt`, and freshness.
- No fixture fallback.
- Stale/unavailable/disagreeing evidence becomes `unknown`, never `pass`.

Both levels use `packages/rule-engine/index.js` and return `pass`, `review`, `breach`, or `unknown`.

## How to Run

Start the server with `terminal`:

```bash
node subapps/rule-studio/server.js
```

Open `http://127.0.0.1:7622`. Verify:

```bash
curl http://127.0.0.1:7622/api/health
```

Expected service: `rule-studio`; capabilities include `paper`, `devnet`, `batch`.

## CLI Quick Reference

Validate one rule:

```bash
node subapps/rule-studio/cli.js validate rule.json
```

Run Paper only:

```bash
node subapps/rule-studio/cli.js run-levels --paper paper.ndjson --summary-only
```

Run Devnet only:

```bash
node subapps/rule-studio/cli.js run-levels --devnet devnet.ndjson --summary-only
```

Run both and publish to UI:

```bash
node subapps/rule-studio/cli.js run-levels \
  --paper paper.ndjson \
  --devnet devnet.ndjson \
  --summary-only \
  --publish http://127.0.0.1:7622
```

Generate synthetic breaches:

```bash
node subapps/rule-studio/cli.js simulate-breach \
  --count 10000 \
  --cluster devnet \
  --summary-only
```

`simulate-breach` remains Paper/synthetic. Never call it monitored Devnet evidence.

## Data Contracts

A batch is a JSON array or NDJSON. Every case is:

```json
{
  "id": "case-1",
  "rule": {
    "id": "nav-ceiling",
    "version": 1,
    "name": "NAV ceiling",
    "cluster": "devnet",
    "field": "nav",
    "operator": "greater_than",
    "threshold": 1.05,
    "nearThresholdPercent": 5,
    "severity": "high",
    "recommendedAction": "Review valuation evidence."
  },
  "evidence": {
    "id": "evidence-1",
    "cluster": "devnet",
    "state": "active",
    "freshness": { "status": "fresh", "ageMs": 1000 },
    "confidence": "verified",
    "coverage": "complete",
    "value": { "nav": 1.06 }
  }
}
```

Devnet additionally requires:

```json
{
  "source": { "id": "devnet-monitor", "type": "monitoring_backend" },
  "slot": 123456,
  "observedAt": "2026-09-26T10:00:00.000Z",
  "fetchedAt": "2026-09-26T10:00:01.000Z"
}
```

Supported operators:

- `equals`
- `greater_than`
- `less_than`
- `percent_change_greater_than`
- `freshness_greater_than`
- `source_disagreement`

## API Quick Reference

- `GET /api/health`
- `GET /api/levels`
- `POST /api/preview` for Paper
- `POST /api/levels/devnet/evaluate` for monitored Devnet evidence
- `POST /api/runs` to publish a Paper or Devnet batch summary

`/api/levels` and published runs are process-local. Restarting the server clears them.

## Procedure for Changes

1. Record scope in `docs/llm-2.md`. Completion: intended files and collision boundaries are explicit.
2. Add one failing focused test under `packages/rule-engine/` or `subapps/rule-studio/`. Completion: failure proves missing behavior.
3. Implement the minimum change without touching Wallet Inspector-owned files. Completion: focused test passes.
4. Preserve one evaluator for Paper, Devnet, batch, and future replay. Completion: no duplicated evaluation logic.
5. Update `subapps/rule-studio/README.md` and root `README.md` when behavior or commands change. Completion: respawn instructions remain accurate.
6. Run focused and full verification. Completion: exact pass/fail totals are recorded in `docs/llm-2.md`.

## Pitfalls

- `--summary-only` suppresses complete results and samples by default; use it for large runs.
- A `devnet` cluster label alone does not make evidence Level 2. Monitoring provenance and slot/time metadata are mandatory.
- `simulate-breach --cluster devnet` means Devnet-shaped fixtures, not real observed Devnet state.
- Published UI state is not durable storage.
- Rule field names must match the safe field pattern; executable-style fields are rejected.
- Mainnet and Devnet cannot coexist in one batch.
- Do not modify files reserved in `llm-roles/` without coordination.

## Verification

Run:

```bash
node --test packages/rule-engine/*.test.js subapps/rule-studio/*.test.js
npm test
node --check packages/rule-engine/index.js
node --check packages/rule-engine/batch.js
node --check subapps/rule-studio/server.js
node --check subapps/rule-studio/cli.js
node --check subapps/rule-studio/app.js
```

Last known verified baseline:

- Focused Rule Studio/rule-engine tests: 19/19.
- Full repository tests: 94/94.
- Scale test: 5,000 deterministic cases.
- CLI exercise: 10,000 synthetic breaches.

Treat these as a baseline, not a substitute for rerunning tests.
