# Domain map

## Core domains

| Domain | Owns | Must not own |
|---|---|---|
| discovery | wallet assets, token ownership, ONYC match | protocol risk conclusions |
| positions | holder-facing ONYC position | raw RPC/indexer schemas |
| protocols/onre | ONRE IDs, evidence links, adapters | generic HTTP/UI |
| indexer | source schema adapter, cursor, freshness | product copy/severity |
| monitoring | baselines, snapshots, rule states | prose generation |
| history | lookbacks, breaches, near-thresholds | separate rule definitions |
| events | normalized event, severity, action template | raw ingestion |
| evidence | provenance, confidence, source references | UI layout |
| evacuation | exact transaction lifecycle | private keys/custody |
| editions | Lite/Pro feature exposure | different truth models |

## Applications

- Lite web: decision-first, mobile-first, no setup beyond wallet address.
- Pro web: evidence-first analyst console.
- API: shared application boundary for both.
- Runner: indexer import, baseline, polling, retrospective evaluation.

## Invariants

1. Lite and Pro derive from identical evidence IDs.
2. Historical and live checks use identical rule definitions.
3. Every status includes source mode and freshness.
4. Unsupported evidence cannot become healthy.
5. Indexer source DB is producer-owned and read-only to Kelvara.
6. Exit preview, simulation, signature request, and broadcast share exact message bytes.
