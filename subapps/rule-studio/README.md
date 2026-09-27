# Kelvara Rule Studio

Deterministic rule authoring and evaluation across two explicitly separated levels.

## Operating model

### Level 1 — Paper

Use fixture evidence for safe, repeatable development and breach simulation.

- No RPC or monitoring dependency.
- Clearly labelled `paper` / simulated.
- Suitable for bulk generation, regression tests, demos, and AI-driven exploration.

### Level 2 — Devnet

Use normalized evidence produced by a real devnet monitoring backend for a program or account.

Required fields:

```json
{
  "id": "devnet:program:observation-1",
  "cluster": "devnet",
  "source": {
    "id": "kelvara-devnet-monitor",
    "type": "monitoring_backend"
  },
  "slot": 123456,
  "observedAt": "2026-09-26T10:00:00.000Z",
  "fetchedAt": "2026-09-26T10:00:01.000Z",
  "state": "active",
  "freshness": { "status": "fresh", "ageMs": 1000, "maxAgeMs": 15000 },
  "confidence": "verified",
  "coverage": "complete",
  "value": { "nav": 1.06 }
}
```

Devnet never falls back to fixture evidence. Missing provenance is rejected. Stale, unavailable, or disagreeing evidence evaluates to `unknown`, never `pass`.

Both levels use the same rule evaluator and Step 03 result shape: `pass`, `review`, `breach`, `unknown`.

## Start

```bash
cd '/home/andycore/hackaton/[HACKATON]/kelvara-onre'
node subapps/rule-studio/server.js
```

Open `http://127.0.0.1:7622`.

## Publish to Alert Console

Rule Studio owns authoring and patching. Alert Console owns durable registry and monitoring activation.

```bash
node subapps/rule-studio/cli.js publish-rules rules.json \
  --alert-console http://127.0.0.1:7623 \
  --actor rule-studio
```

Publishing creates immutable paused versions. It never activates live monitoring. Activate explicitly in Alert Console UI or CLI.

## CLI

All commands emit JSON to stdout and errors as JSON to stderr.

### Validate a rule

```bash
node subapps/rule-studio/cli.js validate rule.json
```

### Paper batch

```bash
node subapps/rule-studio/cli.js run-levels \
  --paper paper-cases.ndjson \
  --summary-only
```

### Devnet batch

```bash
node subapps/rule-studio/cli.js run-levels \
  --devnet devnet-cases.ndjson \
  --summary-only
```

### Paper and Devnet together

```bash
node subapps/rule-studio/cli.js run-levels \
  --paper paper-cases.ndjson \
  --devnet devnet-cases.ndjson \
  --summary-only
```

### Publish both results to the UI

```bash
node subapps/rule-studio/cli.js run-levels \
  --paper paper-cases.ndjson \
  --devnet devnet-cases.ndjson \
  --summary-only \
  --publish http://127.0.0.1:7622
```

The UI polls every three seconds and updates each level independently.

### Generate thousands of paper breaches

```bash
node subapps/rule-studio/cli.js simulate-breach \
  --count 10000 \
  --cluster devnet \
  --summary-only
```

`simulate-breach` is always synthetic. It must not be presented as Devnet monitoring evidence.

## Batch file contract

JSON array or NDJSON; one case per line:

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

For Devnet, add the required monitoring source, slot, `observedAt`, and `fetchedAt` fields shown above.

## API

- `GET /api/health`
- `GET /api/levels`
- `POST /api/preview` — Paper evaluation
- `POST /api/levels/devnet/evaluate` — real normalized Devnet evidence
- `POST /api/runs` — publish Paper or Devnet batch summary

### Publish-run contract

```json
{
  "schemaVersion": 1,
  "runId": "devnet-run-42",
  "cluster": "devnet",
  "level": "devnet",
  "total": 10000,
  "counts": { "pass": 9000, "review": 500, "breach": 400, "unknown": 100 },
  "samples": []
}
```

## Trust boundaries

- Rule Studio executes no JavaScript, SQL, shell, or arbitrary expression supplied by a rule.
- It does not sign or submit transactions.
- Level 2 accepts normalized backend evidence; it does not independently prove that the backend observed chain state correctly.
- Source identity, slot, observation time, fetch time, and freshness remain visible for audit.
- Published run state is process-local and resets when the server restarts.
- Mainnet/devnet evidence cannot be mixed in one evaluation.

## Troubleshooting

- `invalid_devnet_evidence`: add `source.type=monitoring_backend`, source ID, integer slot, observed/fetched timestamps, and `cluster=devnet`.
- `mixed_clusters`: ensure rule and evidence both use `devnet`.
- `unknown`: inspect state/freshness and required value field. Unknown is intentional when evidence cannot support a conclusion.
- `publish_failed_...`: start Rule Studio and confirm `curl http://127.0.0.1:7622/api/health`.
- Large output: use `--summary-only`; complete per-rule results can be large.

## Performance evidence

The automated suite evaluates 5,000 deterministic cases and verifies complete counts. CLI tests also run 3,000 generated breach simulations.
