# Phase-3 network-session review repair

Owned task scope: `subapps/kamino-monitor/{network-session.js,server.js,web/app.js}`, focused network/auth tests, related docs.

Current slice: embedded web evacuation client authentication regression. Planned edits: `subapps/kamino-monitor/web/app.js`, `test/armed-protection.test.js`; add authenticated network/genesis-bound prepare/submit/status coverage. No `kelvara-ui` edits.

Mandatory: canonical network/genesis binding, real HTTP tests, fail-closed errors, bounded RPC streams, atomic challenge consumption, explicit test-only legacy gate. No production deployment or other repository edits.
