# Operations runbook

## Local runtime

API and read-only operations console:

```bash
npm start
```

Open `http://127.0.0.1:7610/operations/`.

Indexer supervisor:

```bash
npm run ingest
```

Both processes must share:

- `KELVARA_DB_PATH`
- `KELVARA_INGESTION_STATUS_PATH`
- `KELVARA_MAINTENANCE_STATUS_PATH`
- `KELVARA_INDEXER_DB_PATH`

Runtime requires Node 22.5.x or newer within Node 22. The store uses `node:sqlite`; Node 20 is unsupported.

The external producer database remains read-only. Kelvara writes only its consumer database and status file.

## Required production configuration

```text
HOST=0.0.0.0
PORT=7610
KELVARA_OPERATIONS_TOKEN=<random secret>
KELVARA_DB_PATH=/data/kelvara.sqlite
KELVARA_INGESTION_STATUS_PATH=/data/ingestion-status.json
KELVARA_MAINTENANCE_STATUS_PATH=/data/maintenance-status.json
KELVARA_INDEXER_DB_PATH=/data/producer/indexer.db
KELVARA_INDEXER_DIR=/opt/kelvara-indexer
```

A non-loopback `HOST` without `KELVARA_OPERATIONS_TOKEN` fails closed during startup.

Optional retention overrides:

```text
KELVARA_RETENTION_RAW_SECONDS=259200
KELVARA_RETENTION_1M_SECONDS=604800
KELVARA_RETENTION_15M_SECONDS=7776000
KELVARA_RETENTION_1H_SECONDS=63072000
```

Overrides must be finite positive values ordered from shortest to longest.

## Operator checks

```bash
curl http://127.0.0.1:7610/api/health
curl http://127.0.0.1:7610/api/sources/onre-indexer
curl -H "Authorization: Bearer $KELVARA_OPERATIONS_TOKEN" \
  http://127.0.0.1:7610/api/operations/status
curl -H "Authorization: Bearer $KELVARA_OPERATIONS_TOKEN" \
  http://127.0.0.1:7610/api/operations/targets
```

Interpretation:

- `health.ok=true` proves the API process responds. It does not prove source freshness.
- `freshness.status=stale` means source data is usable historical evidence, not live evidence.
- `ingestion.caughtUp=false` means backlog remains even if the last bounded cycle succeeded.
- `providers.state=unknown` means no provider-tagged telemetry exists. It is not healthy.
- `observationSuccessRatio` measures successful telemetry observations; it is not service uptime.
- `storage.action` reports `normal`, `warning`, `compact`, `prune`, or `pause-backfill`.

## Retention guarantees

Automatic compaction affects only telemetry samples and telemetry rollups. It does not delete:

- evidence;
- material events;
- current target state;
- watch-target links;
- cursors;
- service incidents.

Default tiers:

- raw: 72 hours;
- 1 minute: 7 days;
- 15 minute: 90 days;
- 1 hour: 730 days.

## Backup

Stop writers or checkpoint WAL before copying the consumer database:

1. Stop the ingestion process.
2. Stop the API process.
3. Copy `kelvara.sqlite`, `ingestion-status.json`, and configuration secrets to encrypted off-machine storage.
4. Keep producer backup/recovery separate from the consumer database.
5. Restore into a temporary directory first; run `PRAGMA integrity_check` before service startup.

Do not copy a live SQLite database over SMB/NFS as the production access model.

## Current producer blocker

The inspected producer DB failed `PRAGMA quick_check` and `PRAGMA integrity_check` because pages 22145–22158 were reported as never used. A local `VACUUM INTO` recovery copy passed integrity checks, but Kelvara must not silently replace or repair the producer-owned DB. Repair/replacement requires an explicit producer maintenance step.

Producer-specific dual-RPC telemetry is also absent: the current producer uses one `HELIUS_RPC`. The operations API returns unknown provider metrics until real provider-tagged observations exist.

## HAOS packaging boundary

Current backend code is HAOS-portable through `/data` paths and `HOST=0.0.0.0`, but no deployable add-on exists yet. Required next packaging slice:

1. Bundle or separately supervise the producer executable; HAOS cannot mount `/home/andy/...`.
2. Run API and ingestion under one process supervisor with independent health/state.
3. Persist all writable state under `/data`.
4. Expose the operations token through add-on options/secrets.
5. Add `config.yaml`, multi-architecture image/build mapping, `run.sh`, resource limits, and Supervisor health endpoint.
6. Build locally, upload through Samba, verify checksums, bump version, install through HAOS Update, then probe the running endpoint.

Do not publish/deploy while the producer integrity issue remains unresolved.
