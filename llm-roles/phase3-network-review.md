# Phase-3 network-session review repair

Owned task scope: `subapps/kamino-monitor/{network-session.js,server.js,web/app.js}`, focused network/auth tests, related docs.

Current slice: embedded web evacuation client authentication regression. Planned edits: `subapps/kamino-monitor/web/app.js`, `test/armed-protection.test.js`; add authenticated network/genesis-bound prepare/submit/status coverage. No `kelvara-ui` edits.

Mandatory: canonical network/genesis binding, real HTTP tests, fail-closed errors, bounded RPC streams, atomic challenge consumption, explicit test-only legacy gate. No production deployment or other repository edits.

### Kamino JSON boundary hardening — 2026-10-07

Reserved scope: `subapps/kamino-monitor/server.js`, `subapps/kamino-monitor/web/evacuation-client.js`, focused boundary tests. No UI repo edits/deploy.

### Program Backend Devnet read-only vertical slice — 2026-10-08

Owned scope: `subapps/kamino-monitor/server.js`, `subapps/kamino-monitor/network-session.js`, `subapps/kamino-monitor/portfolio-orchestrator.js`, focused production HTTP tests. Explicit Devnet genesis-bound auth, canonical empty read-only portfolio/inspect, fail-closed Devnet action routes. No UI, deployment, signing, broadcast, or devnet-demo edits.
