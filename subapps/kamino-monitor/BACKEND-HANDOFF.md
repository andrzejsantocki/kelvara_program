# Kelvara Kamino backend handoff

Last inspected: 2026-09-27

Purpose: give the next implementer enough context to add a Kamino vault-admin change check without breaking the existing Mainnet position inspection, protection, or evacuation contracts.

## Read this first

The active backend implementation is:

- `subapps/kamino-monitor/server.js` — HTTP server, Kamino inspection, Solana RPC decoding, evacuation validation, protection endpoints.
- `subapps/kamino-monitor/protection.js` — wallet challenge authentication, encrypted armed-transaction storage, exact share encoding, fee ladder.
- `test/kamino-monitor.test.js` — primary backend and frontend contract tests.
- `subapps/kamino-monitor/web/app.js` — API consumer. The separately published frontend repository is `andrzejsantocki/kelvara-monitor-ui`.
- `Dockerfile`, `compose.yaml`, `.env.production.example` — production packaging.

The older repository `/home/andycore/kelvara-monitor` is not the backend serving this app. It is an earlier indexer/protocol-explorer foundation.

Important: the working tree currently contains unrelated uncommitted wallet-picker/UI changes. Do not reset, overwrite, reformat, or include them accidentally. Check `git status` and commit only owned files by explicit path.

## Current production status

Observed public endpoints on 2026-09-27:

- `https://api.kelvara.xyz/healthz`
- `https://api.kelvara.xyz/api/config`
- `https://api.kelvara.xyz/api/status`

Observed health response:

```json
{"ok":true,"service":"kamino-monitor","network":"mainnet","monitoring":false,"lastError":null}
```

`monitoring:false` and `monitoredWallet:null` mean the deployed process is not running its optional server-side wallet polling loop. Browser monitoring still re-runs `/api/inspect/:wallet` every 60 seconds while the monitor page is active. A durable background admin monitor requires either `MONITORED_WALLET` or, preferably, a new wallet-independent control-plane poll.

## Fixed Mainnet identities

Defined in exported `KAMINO` in `server.js`:

| Item | Address |
|---|---|
| Target vault state | `BoZDRc1RDY9FzUZZ19WT4GbtTnnbXQ8AGSU5ByEw3ut5` |
| Share mint | `4hKmkq2SkthLPceEBJXpyvH9m9PvNpFwasoB8mZgJ6rE` |
| Underlying USDG mint | `2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH` |
| Kamino kVault program | `KvauGMspG5k6rtzrqqn7WNn3oZdyKqLKwK2XWQ8FLjd` |
| Upgradeable loader | `BPFLoaderUpgradeab1e11111111111111111111111` |
| Expected ProgramData | `GeZ7nkkcbJ6VVV1XVFbmFnLCY3F1LPBGk6cufDZvrbGn` |
| Expected program upgrade authority | `GzFgdRJXmawPhGeBsyRCDLx4jAKPsvbUqoqitzppkzkW` |

These identities are transaction-safety boundaries. Do not silently replace them from an API response.

## What is checked today

`createKaminoInspector().inspect(wallet)` currently:

1. Validates the public Solana wallet address.
2. Calls Kamino API `GET /kvaults/users/:wallet/positions`.
3. Selects only the exact pinned vault with positive `totalShares`.
4. Calls `GET /kvaults/:vault/metrics` and computes `underlyingAmount = totalShares * tokensPerShare` using decimal-safe string arithmetic.
5. Filters positions whose exact underlying amount is `<= 0.001 USDG`.
6. Calls Solana RPC `getAccountInfo(KAMINO.program)`.
7. Decodes Upgradeable Loader `Program` state and verifies its ProgramData address equals the pinned `KAMINO.programData`.
8. Calls `getAccountInfo(programData)`.
9. Decodes Upgradeable Loader `ProgramData` state and compares its upgrade authority with `KAMINO.expectedUpgradeAuthority`.
10. Returns `authority.status` as `active` or `breach`.

This is a **program upgrade-authority check**, not a Kamino vault-admin check.

A program upgrade authority can replace the kVault executable code. A vault admin controls this particular vault's configuration, fees, allocations, and ownership. Both matter, but they are different authorities and must remain separate evidence/rules.

## Where the vault admin lives on-chain

Read the exact vault account:

```text
BoZDRc1RDY9FzUZZ19WT4GbtTnnbXQ8AGSU5ByEw3ut5
```

Required validation before decoding:

- Account exists.
- Account owner equals pinned kVault program `KvauGMspG5k6rtzrqqn7WNn3oZdyKqLKwK2XWQ8FLjd`.
- Data length is at least the canonical VaultState size plus its 8-byte discriminator. Current upstream layout is 62,544 bytes; full account data is 62,552 bytes.
- First 8 bytes equal the Anchor discriminator `sha256("account:VaultState")[0..8]`.
- Decode using a pinned canonical layout/version. Do not search raw bytes for known addresses.

Canonical upstream definitions:

- `https://github.com/Kamino-Finance/kvault/blob/master/libs/kvault-interface/src/state/vault_state.rs`
- `https://github.com/Kamino-Finance/kvault/blob/master/libs/kvault-interface/src/state/mod.rs`
- `https://kamino.com/docs/build/developers/earn/data/vault-data`
- `https://kamino.com/docs/curators/vaults/concepts/roles-and-ownership`

Relevant `VaultState` fields:

- `vault_admin_authority` — full vault control.
- `pending_admin` — nominated next admin in the two-step vault-admin transfer. A non-baseline pending admin is an early warning even before control changes.
- `allocation_admin` — can change weights, caps, types, and priorities for existing reserves; transfer is single-step.

Live observations from Kamino's vault-list API on 2026-09-27, for discovery only:

```text
vault_admin_authority = 9ceRgz579BcfWogs3RE11FKNQaWW7Lmtnev3MXspxUjF
pending_admin         = 9ceRgz579BcfWogs3RE11FKNQaWW7Lmtnev3MXspxUjF
allocation_admin      = CuEC7JoZtHx9v5MQWrNTsLSGMEixbCEvTX6K6kWZzz7q
```

Do **not** treat these observations as approved baselines merely because they were observed once. Confirm intended governance/Squads identities, then pin explicit expected values in source/config with review. The security decision must use raw Solana RPC state; Kamino API may be used only as secondary corroboration.

## Recommended implementation shape

Keep user-position discovery separate from protocol control evidence.

Suggested functions in `server.js` or a new focused module:

```js
async function fetchProgramControlEvidence(...)
async function fetchVaultControlEvidence(...)
async function inspectControlPlane(...)
```

`fetchVaultControlEvidence` should return a stable object such as:

```json
{
  "ruleId": "kamino-kvault-vault-admin",
  "status": "active",
  "current": "...",
  "expected": "...",
  "pendingAdmin": "...",
  "expectedPendingAdmin": "...",
  "allocationAdmin": "...",
  "expectedAllocationAdmin": "...",
  "vault": "BoZD...3ut5",
  "ownerProgram": "Kvau...FLjd",
  "slot": 123,
  "observedAt": "ISO-8601",
  "source": "solana_rpc",
  "meaning": "The vault admin controls this vault's configuration; pending admin signals an initiated transfer."
}
```

Prefer adding `vaultAuthority` or `controls.vaultAdmin` alongside the existing `authority` field. Do not repurpose or rename `authority`: the current frontend expects it to describe the program upgrade authority.

Status guidance:

- `active`: all explicitly configured baselines match and evidence is valid/fresh.
- `review` or a dedicated warning state: unexpected `pending_admin` but current admin unchanged.
- `breach`: current vault admin or allocation admin differs from the pinned baseline.
- `unknown`: unavailable, malformed, wrong owner, discriminator mismatch, unsupported layout, or stale RPC evidence.

Never convert missing/invalid evidence into `active`. If the existing frontend only understands `active|breach`, either extend it explicitly or conservatively map uncertain control evidence to a non-healthy state while retaining a machine-readable reason.

## Rules to add

These are separate rules. Do not collapse them into one generic `admin changed` result: one verifies who currently has power; the other verifies whether a transfer was disclosed before it took effect.

### Rule 1 — Verify effective admin rights

```json
{
  "ruleId": "kamino-kvault-effective-admin-rights",
  "subject": "BoZDRc1RDY9FzUZZ19WT4GbtTnnbXQ8AGSU5ByEw3ut5",
  "checks": [
    "program_upgrade_authority equals expectedProgramUpgradeAuthority",
    "vault_admin_authority equals expectedVaultAdminAuthority",
    "allocation_admin equals expectedAllocationAdmin",
    "pending_admin equals expectedPendingAdmin"
  ],
  "source": "validated_solana_rpc_account_bytes",
  "result": "pass|review|breach|unknown"
}
```

Evaluation order:

1. Validate the program, ProgramData, and VaultState account identities, owners, discriminators, layouts, RPC slot, and freshness.
2. Decode the four authority fields independently. Report full public keys; never reduce the result to labels such as `Kamino team` without a reviewed address-to-entity registry.
3. Return `unknown` if any required evidence is missing, stale, malformed, from the wrong owner, or from conflicting RPC observations.
4. Return `breach` if `program_upgrade_authority`, `vault_admin_authority`, or `allocation_admin` differs from its approved pinned baseline.
5. Return `review` if effective authorities still match but `pending_admin` differs from its approved baseline. This is an initiated transfer, not yet proof that control changed.
6. Return `pass` only when every configured authority matches and all evidence is valid and fresh.

Required output:

```json
{
  "ruleId": "kamino-kvault-effective-admin-rights",
  "result": "pass",
  "authorities": {
    "programUpgrade": { "current": "...", "expected": "...", "matches": true },
    "vaultAdmin": { "current": "...", "expected": "...", "matches": true },
    "pendingAdmin": { "current": "...", "expected": "...", "matches": true },
    "allocationAdmin": { "current": "...", "expected": "...", "matches": true }
  },
  "slot": 123,
  "observedAt": "ISO-8601",
  "source": "solana_rpc"
}
```

### Rule 2 — Detect an unannounced admin rollover

Rule ID: `kamino-kvault-unannounced-admin-rollover`.

An on-chain admin change proves a rollover. It does **not** by itself prove that the change was unannounced. That conclusion requires a separate, explicit announcement source. Do not scrape arbitrary social posts and treat absence as proof.

Use an approved announcement registry containing signed or operator-reviewed records:

```json
{
  "vault": "BoZDRc1RDY9FzUZZ19WT4GbtTnnbXQ8AGSU5ByEw3ut5",
  "role": "vault_admin_authority",
  "from": "old-admin-pubkey",
  "to": "new-admin-pubkey",
  "announcedAt": "ISO-8601",
  "effectiveAfter": "ISO-8601",
  "sourceUrl": "https://...",
  "contentHash": "sha256:...",
  "approvedBy": "operator-or-governance-identity"
}
```

Evaluate each transition independently for `program_upgrade_authority`, `vault_admin_authority`, and `allocation_admin`:

1. Persist the last valid observation with pubkey, slot, block time, and account-data hash.
2. A rollover exists only when two valid observations show `old != new`. Record the first observed changed slot and resolve its transaction/signature when available.
3. Find an approved announcement matching the exact vault, role, `from`, and `to` identities.
4. Require `announcedAt < effective change block time`. A configurable minimum notice window may be added later; do not invent one silently.
5. Return `breach` when a confirmed rollover has no matching approved pre-announcement, or when the only matching announcement was published after the change.
6. Return `pass` when a confirmed rollover has a matching approved pre-announcement.
7. Return `review` when `pending_admin` changes without a matching pre-announcement, because transfer intent changed but effective vault control has not rolled over yet.
8. Return `unknown` when chain history, block time, the approved announcement registry, or registry freshness is unavailable. Absence from an unavailable or incomplete source is not evidence of non-disclosure.
9. Deduplicate by `vault + role + old + new + firstChangedSlot`. Never auto-approve the new admin or rewrite the baseline after a breach.

Required rollover output:

```json
{
  "ruleId": "kamino-kvault-unannounced-admin-rollover",
  "result": "breach",
  "vault": "BoZDRc1RDY9FzUZZ19WT4GbtTnnbXQ8AGSU5ByEw3ut5",
  "role": "vault_admin_authority",
  "from": "...",
  "to": "...",
  "firstChangedSlot": 123,
  "changeSignature": "...",
  "changedAt": "ISO-8601",
  "announcement": null,
  "reason": "confirmed_admin_rollover_without_matching_preannouncement",
  "chainSource": "solana_rpc",
  "announcementSource": "approved_announcement_registry"
}
```

`pending_admin` may equal the current admin in the canonical idle state. Baseline its exact approved value; do not assume the zero address is the only safe idle representation.

## Decoupling required for real background monitoring

Today `inspect(wallet)` returns before any authority RPC calls when no target position is found. The server's `poll()` also calls `inspector.inspect(monitoredWallet)`, so authority monitoring is coupled to one wallet and one indexed position.

For a true admin-change checker:

1. Fetch program/vault control evidence independently of Kamino user-position API state.
2. Poll the control plane on a fixed interval even when no wallet is configured.
3. Keep optional wallet-position polling separate.
4. Persist at least the approved baseline, last valid observation, slot, timestamp, and transition history if alerts must survive restarts.
5. Do not overwrite an approved baseline automatically after observing a change.
6. Alert on transitions; avoid emitting a new incident every poll for the same unchanged mismatch.

Do not block `/api/inspect/:wallet` indefinitely on alert delivery. Inspection should return evidence; notification/persistence should be separate.

## Existing API contracts to preserve

### `GET /healthz`

Current fields:

```json
{
  "ok": true,
  "service": "kamino-monitor",
  "network": "mainnet",
  "monitoring": false,
  "lastError": null
}
```

Adding fields is safer than changing/removing existing fields. Decide whether control-plane failure makes the service `503`; document that policy and test it.

### `GET /api/config`

Current fields: `network`, `vault`, `name`, `program`, `walletSigning`, `evacuation`.

### `GET /api/status`

Current fields: `monitoredWallet`, `last`, `lastError`.

Add control-plane state additively, for example `controlLast` and `controlLastError`.

### `GET /api/inspect/:wallet`

Current successful-position response contains:

- `network`
- `wallet`
- `position`
- `authority` — existing program-upgrade authority evidence
- `observedAt`
- `sourceStatus`

No-position and dust responses intentionally return `position:null` and `authority:null`. Preserve those existing fields and `sourceStatus` values:

- `kamino_index_pending_or_no_position`
- `dust_filtered`
- `kamino_api_plus_solana_rpc`

If vault control evidence should be visible without a position, add a separate field; do not make a fake position or silently alter the existing position gate.

### Protection/authentication endpoints

Preserve all current paths and Bearer-token behavior:

- `POST /api/auth/challenge`
- `POST /api/auth/verify`
- `GET /api/protection/status`
- `POST /api/protection/nonce-setup/prepare`
- `POST /api/protection/nonce-setup/submit`
- `POST /api/protection/prepare`
- `POST /api/protection/arm`
- `POST /api/protection/fast-close`
- `POST /api/protection/revoke/prepare`
- `POST /api/protection/revoke`
- `POST /api/protection/revoke/finalize`

Wallet auth challenges/sessions are process-local. Armed bundles are encrypted at rest with AES-256-GCM under `.runtime/kamino-monitor/`.

### Evacuation endpoints

- `POST /api/evacuation/prepare`
- `POST /api/evacuation/submit`
- `GET /api/evacuation/status/:signature`

Admin monitoring must not loosen `validateEvacuationTransaction` or any pinned programs/accounts/instruction ordering. That validator is an independent transaction-safety boundary.

## Security boundaries not to weaken

- Mainnet only for this subapp.
- No seed phrase, private key, wallet file, signer service, or browser RPC secret on the server.
- Wallet signing remains client-side.
- CORS allowlist defaults to `https://app.kelvara.xyz` plus local port 7650.
- Protected write endpoints are rate-limited.
- Request bodies are bounded.
- Evacuation transactions are allowlisted by program, account, signer, instruction sequence, amount, and destination.
- Submission checks existing signature status and does not blindly resend uncertain transactions.
- Pinned vault/program/mints remain explicit.
- Wrong account owner, wrong discriminator, changed ProgramData address, malformed bytes, and RPC disagreement must fail closed.

## Tests to add first

Use RED → GREEN → REFACTOR in `test/kamino-monitor.test.js` or a new focused test file.

Minimum cases:

1. Decodes canonical VaultState fixture and reports matching vault admin.
2. Current vault admin differs: `breach`.
3. Unexpected non-default/different pending admin: warning/review.
4. Allocation admin differs: `breach` or separately defined high-severity result.
5. Vault account owner is not `KAMINO.program`: `unknown`/error, never active.
6. VaultState discriminator mismatch: `unknown`/error.
7. Account data too short or unsupported layout: `unknown`/error.
8. RPC unavailable: no false healthy result.
9. Existing `authority` response contract remains unchanged.
10. No-position/dust behavior remains unchanged.
11. `/api/status` additions are backward-compatible.
12. Polling deduplicates unchanged incidents and records a transition once.
13. Existing evacuation and protection tests still pass.
14. Every authority output includes current, expected, and exact match state.
15. Confirmed admin rollover with a matching earlier approved announcement: `pass`.
16. Confirmed admin rollover with no matching announcement: `breach`.
17. Announcement published after the effective change: `breach`.
18. Pending admin changes without a matching announcement: `review`, not an effective-rollover claim.
19. Announcement registry unavailable or stale: `unknown`, never `pass` or a definitive `unannounced` claim.
20. Announcement for the wrong vault, role, `from`, or `to` does not match.
21. Repeated observation of the same rollover deduplicates by transition identity.

Do not create fixtures by copying only expected addresses into arbitrary offsets. Construct bytes from the canonical pinned layout/discriminator so layout drift is detectable.

## Verification commands

From repository root:

```bash
node --test test/kamino-monitor.test.js
node --check subapps/kamino-monitor/server.js
node --check subapps/kamino-monitor/protection.js
npm test
npm run check
git diff --check
```

Then exercise a real read-only Mainnet query with a keyed server-side RPC. Compare raw RPC decoding with Kamino API only as a secondary check. Never run evacuation/protection write endpoints merely to test admin monitoring.

## Deployment cautions

- `api.kelvara.xyz` is backend; `app.kelvara.xyz` is the separate GitHub Pages frontend.
- The backend Docker process binds `127.0.0.1`; public TLS/reverse proxy exists outside this repository.
- `compose.yaml` currently declares a read-only container, while current armed-protection startup writes `.runtime/kamino-monitor/protection.key` and `armed-protection.enc`. Verify the real production volume/filesystem arrangement before redeploying; do not assume the compose file fully reflects the live service.
- Public Solana RPC is rate-limited. Production polling should use a keyed server-side RPC.
- Preserve response fields consumed by the public frontend before deploying backend changes.
- Verify `/healthz`, `/api/config`, `/api/status`, and one read-only `/api/inspect/:wallet` after deployment.

## Known documentation drift

`subapps/kamino-monitor/README.md` says durable nonce transactions are intentionally not used, but current code implements three durable-nonce armed variants for protection. Treat `server.js`, `protection.js`, and passing tests as behavioral truth. Update that README in the same change if the protection design is intentionally retained.

## Definition of done for the admin-change feature

- Vault admin, pending admin, and allocation admin come from validated raw Mainnet account bytes.
- Expected baselines are explicitly approved and pinned; never self-learned after startup.
- Existing program upgrade-authority evidence remains intact and separately named.
- Missing/malformed/stale evidence cannot report healthy.
- Background control polling no longer depends on a user having a position.
- API additions are backward-compatible.
- Change transitions persist/deduplicate according to a documented policy.
- Focused and full tests pass.
- Live read-only verification succeeds before any production deployment.
- No unrelated working-tree changes are committed.

## Implementation status — 2026-09-27

Implemented in `server.js`:

- Canonical 62,552-byte VaultState decoding with owner and discriminator validation.
- Independent `inspectControlPlane()` reads program upgrade, vault, pending, and allocation authorities.
- `kamino-kvault-effective-admin-rights` returns `pass|review|breach|unknown`; missing approved baselines or invalid evidence returns `unknown`.
- `kamino-kvault-unannounced-admin-rollover` compares consecutive valid observations, matches exact reviewed announcements, and deduplicates transitions.
- Control polling runs without `MONITORED_WALLET`.
- `/api/status` additively exposes `controlLast`, `controlLastError`, and `controlIncidents`; `/api/inspect/:wallet` exposes `vaultAuthority` even without a qualifying position.
- Production configuration accepts explicit authority baselines and a reviewed announcement JSON registry.

Current limit: observations and incidents are process-local. A restart establishes a fresh observation baseline, so durable cross-restart transition history remains future work. The backend does not silently claim historical coverage it does not possess.

## Sources

- Current backend source and tests in this repository.
- Kamino kVault canonical state: https://github.com/Kamino-Finance/kvault/blob/master/libs/kvault-interface/src/state/vault_state.rs
- Kamino account decoder: https://github.com/Kamino-Finance/kvault/blob/master/libs/kvault-interface/src/state/mod.rs
- Kamino vault-data documentation: https://kamino.com/docs/build/developers/earn/data/vault-data
- Kamino roles/ownership documentation: https://kamino.com/docs/curators/vaults/concepts/roles-and-ownership
