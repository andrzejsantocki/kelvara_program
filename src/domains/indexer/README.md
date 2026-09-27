# Indexer domain

Consumes the producer-owned ONRE protocol index read-only.

Source default:

`/home/andy/kelvara-build/[codebase]/indexer_anchor_protocol/indexer.db`

Current contract:

- required tables: `signatures`, `raw_instructions`, `raw_accounts`, `discriminator_list`;
- `raw_instructions.program_id` required to prevent cross-program guessing;
- source status: `live`, `stale`, or `unavailable`;
- pending/failed counts reported independently from source age;
- ingestion mode currently `polling-source`, not realtime.
