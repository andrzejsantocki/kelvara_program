# Architecture

## Boundary

The hackathon codebase lives entirely under this folder. Each business domain has a separate folder; shared infrastructure remains under `src/platform`.

The existing indexer stays an independent producer. Kelvara consumes its SQLite evidence without coupling UI logic to its schema.

```text
indexer_anchor_protocol
  └─ indexer.db (producer-owned, WAL)
           ↓ read-only/incremental cursor
kelvara-onre
  ├─ evidence normalization
  ├─ holder-position model
  ├─ rules/history/events
  ├─ Kelvara SQLite (consumer-owned)
  ├─ Lite API/view
  └─ Pro API/view
```

## Indexer integration decision

Do not let the web app write to `indexer.db`.

Adapter responsibilities:

1. Open source DB read-only.
2. Validate expected schema/version.
3. Read rows after a persisted slot/signature cursor.
4. Normalize raw rows into Kelvara evidence.
5. Upsert idempotently into Kelvara-owned SQLite.
6. Publish freshness, pending, failed, and source-lag status.
7. Never call stale data live.

The source DB uses WAL, so one writer plus read-only consumers is viable. Copying the entire DB on each request is not viable. Incremental import or direct read views are required.

## Indexer operational gap

Current `indexer_anchor_protocol` supports historical crawl, `--recent`, processing, and account snapshots, but exits after each CLI run. Therefore “new transaction is instantaneous” is not yet true.

MVP runner options:

- first: supervised loop every 10–15 seconds: `--recent` → `--process` → `--accounts`;
- better later: long-running subscription/poll runner inserting each new signature and processing it once.

The UI reports `polling`, not `realtime`, until measured subscription latency exists.

## Lite vs Pro

### Shared foundation

- same source rows;
- same normalized evidence;
- same rule evaluator;
- same severity and uncertainty;
- same freshness labels;
- same exit transaction and simulation.

### Lite

Purpose: answer a holder's questions quickly.

- What do I hold?
- What is checked now?
- How did these rules behave historically?
- Were there breaches or near-threshold events?
- What value is affected?
- What cannot Kelvara prove?
- Can I prepare a supported exit?

### Pro

Purpose: investigate why the holder summary exists.

- raw account/change matrix;
- full slot/time history;
- instruction/discriminator analytics;
- controlled-account registry;
- source and decoder diagnostics;
- custom filters/rules;
- API/export.

The CORE dashboard is useful Pro inspiration. Its dense tables, protocol selector, state matrices, and instruction analytics must not become the Lite first screen.

## Initial vertical slice

```text
wallet address
  → token accounts
  → exact ONYC mint match
  → aggregate wallet-owned balance
  → ONRE registry evidence
  → current program/control snapshot
  → historical indexer coverage/freshness
  → Lite position summary
  → Pro evidence link
```

Pass condition: a real wallet produces an ONYC client view; unsupported evidence is explicit; stale indexer data is not labelled live.
