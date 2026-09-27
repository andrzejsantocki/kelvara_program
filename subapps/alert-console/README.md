# Kelvara Alert Console

Independent local console for ingesting evidence-linked rule outcomes, deduplicating repeated breaches, and managing alert lifecycle.

## Trust model

Modes never collapse into each other:

- `paper` — synthetic Paper evaluation.
- `fixture_simulation` — Fixture Lab simulation.
- `devnet` — real normalized monitoring-backend evidence from Devnet.
- `historical` — retrospective evaluation.
- `live` — live production-class evidence; no producer is wired yet.

A `devnet` mode event requires:

- `cluster: "devnet"`
- `source.id`
- `source.type: "monitoring_backend"`
- integer `slot`
- at least one `evidenceId`

A label alone cannot turn fixture input into monitored Devnet evidence.

## Run

```bash
node subapps/alert-console/server.js
```

Open `http://127.0.0.1:7623`.

Custom port:

```bash
ALERT_CONSOLE_PORT=8000 node subapps/alert-console/server.js
```

Health:

```bash
curl http://127.0.0.1:7623/api/health
```

Rule registry and activation/audit state use SQLite at `var/alert-console.sqlite` by default and survive restart. Override with `ALERT_CONSOLE_DB`. Alert instances remain process-local in this slice; restart clears the alert queue but not monitoring rules.

## Event contract

```json
{
  "eventId": "event-1",
  "dedupKey": "program:authority:change",
  "mode": "devnet",
  "level": "devnet",
  "cluster": "devnet",
  "subject": { "type": "program", "id": "Program111" },
  "ruleId": "authority-rule",
  "ruleVersion": 1,
  "status": "breach",
  "severity": "high",
  "uncertainty": "single_source",
  "evidenceIds": ["evidence-1"],
  "recommendedAction": "Review authority change.",
  "solanaMeaning": "The Upgradeable Loader ProgramData account's upgrade authority changed.",
  "occurredAt": "2026-09-26T12:00:00.000Z",
  "source": { "id": "devnet-monitor", "type": "monitoring_backend" },
  "slot": 123
}
```

`status` accepts `pass`, `review`, `breach`, or `unknown`.

- `breach` and `review` create or update alerts.
- Identical active dedup identities increment occurrences instead of creating alert noise.
- `pass` resolves a matching open/acknowledged alert; it never creates a green alert.
- A new breach after resolution supersedes the old alert and creates a new open alert.

Dedup identity includes mode, cluster, dedup key, rule ID/version, and subject. Paper and Devnet cannot collide.

## Durable monitoring rule registry

Rule Studio authors and patches rules. Alert Console owns monitoring activation.

Publish immutable rule versions into Alert Console; every published version starts paused:

```bash
node subapps/rule-studio/cli.js publish-rules rules.json \
  --alert-console http://127.0.0.1:7623 \
  --actor rule-studio
```

Activate one or many versions using a JSON array of `{ "id": "...", "version": 1 }`:

```bash
node subapps/alert-console/cli.js activate-rules refs.json \
  --api http://127.0.0.1:7623 \
  --actor operator
```

Pause them:

```bash
node subapps/alert-console/cli.js pause-rules refs.json \
  --api http://127.0.0.1:7623
```

List registry state:

```bash
node subapps/alert-console/cli.js list-rules \
  --api http://127.0.0.1:7623 \
  --activation active
```

Only one version of a given rule ID can be active. Activating a newer version pauses older versions. Publishing never activates.

Submit normalized monitoring evidence. Alert Console evaluates every matching active Devnet rule and creates/resolves alerts:

```bash
node subapps/alert-console/cli.js monitor evidence.json \
  --api http://127.0.0.1:7623
```

Monitoring evidence requires Devnet cluster, monitoring-backend source identity, integer slot, subject, evidence ID, and normal rule-engine evidence fields.

## Manual fixture-alert simulation

The integrated stack starts with zero alerts. In the Alert Console UI, use:

- `Activate pause alert`
- `Activate authority alert`
- `Activate vault alert`
- `Clear fixture alerts`

Equivalent CLI commands:

```bash
node subapps/alert-console/cli.js simulate pause
node subapps/alert-console/cli.js simulate authority
node subapps/alert-console/cli.js simulate vault
node subapps/alert-console/cli.js clear-fixtures
```

The user frontend at `http://127.0.0.1:7620` polls Alert Console and reflects activation/clearing within five seconds.

Each manual fixture alert includes `solanaMeaning`, a plain-language explanation of the real Solana account/state transition represented by the simulation. It describes observable evidence, not an automatic root-cause conclusion.

## Expected interaction experience

1. Start the integrated stack. Both Alert Console and the user frontend show zero alerts.
2. Open the user frontend, select `devnet-fixture`, and connect the deterministic fixture holder. The 1,000,000 ONYC position appears.
3. Keep the user frontend visible. Open Alert Console in another tab.
4. Click one fixture control—or run its equivalent CLI command.
5. Alert Console immediately shows one open `fixture_simulation` alert through SSE.
6. Within five seconds, the user frontend shows the same alert and its **What this represents on Solana** explanation.
7. Repeating an unchanged alert increments its occurrence count instead of creating duplicate noise.
8. Acknowledge or resolve from Alert Console to exercise lifecycle handling.
9. Click `Clear fixture alerts` or run `clear-fixtures`. Both views return to an empty alert state.

Expected meanings:

- **Pause:** the decoded ONRE state/config account changed its `paused` field to true; this is not the Solana executable being frozen.
- **Authority:** the Upgradeable Loader ProgramData account’s upgrade authority changed; that authority can replace executable bytes until removed.
- **Vault outflow:** an ONRE-controlled SPL token vault balance decreased sharply between slots; this is evidence of movement, not proof of theft.

## CLI

Input accepts a JSON object, JSON array, or NDJSON.

Ingest events:

```bash
node subapps/alert-console/cli.js ingest events.ndjson \
  --api http://127.0.0.1:7623
```

List alerts:

```bash
node subapps/alert-console/cli.js list \
  --api http://127.0.0.1:7623 \
  --mode devnet \
  --lifecycle open \
  --severity high
```

Acknowledge:

```bash
node subapps/alert-console/cli.js acknowledge '<alert-id>' \
  --api http://127.0.0.1:7623 \
  --actor llm-operator
```

Resolve:

```bash
node subapps/alert-console/cli.js resolve '<alert-id>' \
  --api http://127.0.0.1:7623 \
  --resolution reviewed
```

CLI stdout is machine-readable JSON. Failures use JSON on stderr and a nonzero exit code.

## HTTP API

- `GET /api/health`
- `GET /api/alerts?mode=&lifecycle=&severity=`
- `GET /api/rules`
- `GET /api/rules/audit`
- `GET /api/stream` — SSE lifecycle changes
- `POST /api/events`
- `POST /api/rules` — publish one immutable, initially paused version
- `POST /api/rules/activate`
- `POST /api/rules/pause`
- `POST /api/monitor/evidence`
- `POST /api/alerts/:id/acknowledge` with `{ "actor": "..." }`
- `POST /api/alerts/:id/resolve` with `{ "resolution": "..." }`

Request bodies are capped at 1 MiB.

## UI behavior

- Mode tabs prevent accidental context mixing.
- Lifecycle filter controls the current queue.
- Summary counters reflect the filtered view.
- Evidence panel preserves rule version, subject, source, slot, uncertainty, evidence IDs, and occurrence timestamps.
- SSE updates the UI without polling.
- Acknowledge and resolve require explicit operator actions.

## Source map

- `packages/alert-store/index.js` — validation, lifecycle, deduplication, subscriptions.
- `packages/alert-store/alert-store.test.js` — store behavior.
- `subapps/alert-console/server.js` — static server, API, SSE.
- `subapps/alert-console/cli.js` — LLM/operator client.
- `subapps/alert-console/{index.html,styles.css,app.js}` — minimal white UI.
- `subapps/alert-console/*.test.js` — integration and CLI coverage.

## Verification

```bash
node --test packages/alert-store/*.test.js subapps/alert-console/*.test.js
node --check packages/alert-store/index.js
node --check subapps/alert-console/server.js
node --check subapps/alert-console/cli.js
node --check subapps/alert-console/app.js
npm test
```

## Current limitations

- Rule registry, activation, and audit are durable; alert instances are not yet durable.
- No authentication or multi-user authorization.
- No external notification channels.
- Rule Studio publishing and monitoring evidence use explicit API/CLI calls; no autonomous polling daemon yet.
- No Mainnet monitored producer.

These limits are explicit. Do not describe the MVP as production alerting.
