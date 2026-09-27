# Kelvara ONRE agent instructions

## Mandatory startup

Before any implementation:

1. Read `README.md`.
2. Read every file under `llm-roles/`.
3. Read `docs/llm-2.md`.
4. For Rule Studio work, read `skills/kelvara-rule-studio/SKILL.md` and `subapps/rule-studio/README.md`.
5. For Alert Console work, read `skills/kelvara-alert-console/SKILL.md` and `subapps/alert-console/README.md`.
6. Inspect recent file modification times and current running services.
7. Write intended ownership/scope to the appropriate coordination file before editing.

## Multi-agent safety

- Unexpected changes belong to another LLM developer.
- Never revert, overwrite, reformat, or opportunistically fix another agent's files.
- LLM-2 records plans and progress in `docs/llm-2.md`.
- Wallet Inspector ownership is documented under `llm-roles/`.
- If a shared file must change, record the reason and exact intended edit before touching it.

## Product invariants

- Every mini-app remains independently runnable.
- Every mini-app exposes `/api/health`.
- Mainnet and Devnet evidence never mix.
- Paper/synthetic evidence is never presented as monitored Devnet evidence.
- Devnet Rule Studio evidence requires backend source identity, slot, observed/fetched timestamps, and freshness.
- Missing, stale, unavailable, or disagreeing evidence never yields a healthy/pass conclusion.
- Rules are declarative. Never execute user JavaScript, SQL, shell, or arbitrary expressions.
- No private keys, seed phrases, Ledger data, RPC credentials, or signed transactions in logs.
- Rule Studio performs no signing or chain writes.
- UIs remain minimal, responsive, white-mode, and operationally clear.

## Rule Studio architecture

- `packages/rule-engine/index.js`: one deterministic evaluator for every mode.
- `packages/rule-engine/batch.js`: bulk evaluation and summaries.
- `subapps/rule-studio/cli.js`: JSON/NDJSON automation CLI.
- `subapps/rule-studio/server.js`: local API, UI server, process-local latest-level state.
- Paper level: fixture/synthetic evidence; Mainnet or Devnet provenance.
- Devnet level: real normalized monitoring-backend evidence; Devnet only.
- Both levels return `pass`, `review`, `breach`, or `unknown` using the same Step 03 model.

## Development discipline

Use strict RED → GREEN → REFACTOR:

1. Add one failing focused test.
2. Run it; confirm expected failure.
3. Implement minimum behavior.
4. Run focused tests.
5. Run `npm test`.
6. Update documentation and coordination status.

Canonical Rule Studio verification:

```bash
node --test packages/rule-engine/*.test.js subapps/rule-studio/*.test.js
npm test
node --check packages/rule-engine/index.js
node --check packages/rule-engine/batch.js
node --check subapps/rule-studio/server.js
node --check subapps/rule-studio/cli.js
node --check subapps/rule-studio/app.js
```

Do not claim success without real command output.
