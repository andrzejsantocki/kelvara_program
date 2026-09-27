# Kelvara Devnet Scenario Capsule

Real Solana Devnet journey: fund an ephemeral wallet, deposit sandbox USDC into Saturn Earn, discover the naked position, arm Kelvara with a browser-signed durable-nonce exit, trigger a breach, and verify autonomous token evacuation.

## Status

Implemented first program slice:

- Anchor program workspace.
- Per-visitor session PDA.
- TTL bounded to 30–300 seconds.
- Scenario flags: pause, NAV jump, authority change, compound.
- Explicit manual reset.
- Scheduled on-chain reset after expiry, plus logical baseline semantics if the reset transaction is delayed.
- On-chain `SessionInitialized`, `ScenariosTriggered`, and `SessionReset` events.
- Random 32-byte server-side session IDs and Devnet Explorer URL helpers.

Deployed and verified on Devnet at program `GGwyWv1goVjyTiH9tQ72uXrn2voF56eZESnM4rEwrY98`. Deployment slot: `504428262`. Upgrade authority: `DpbwVS5RYtUon7DVPDHXDSkDKVhxermbYytRP9fGhxXv`.

## Program identity

Program ID:

```text
GGwyWv1goVjyTiH9tQ72uXrn2voF56eZESnM4rEwrY98
```

Program keypair is intentionally outside the repository:

```text
~/.config/kelvara/scenario-capsule-keypair.json
```

Never delete or commit that keypair. `target/deploy/` is not authoritative.

## Why state is not literally reverted

Solana transaction history is immutable. The capsule stores `expires_at`; consumers interpret expired sessions as baseline (`flags = 0`). The live server schedules `reset_session` at expiry to produce a visible reset fingerprint. If that transaction is delayed or the server restarts, on-chain expiry still makes the effective state baseline. Old trigger transactions remain permanent proof.

## PDA isolation

```text
["demo-session", sponsor_pubkey, random_32_byte_session_id]
```

Every visitor receives a fresh random session ID. The sponsor authority signs mutations, so visitors cannot modify another capsule.

## Scenario bits

| Scenario | Bit |
|---|---:|
| paused | 1 |
| nav_jump | 2 |
| authority_changed | 4 |
| compound | 7 |

## Build and test

```bash
cd devnet-demo
cargo test --workspace
anchor build
node --test client.test.js
```

Expected artifacts:

```text
target/deploy/scenario_capsule.so
target/idl/scenario_capsule.json
target/types/scenario_capsule.ts
```

## Devnet deployment

Before deployment:

```bash
solana balance --url devnet
solana program show GGwyWv1goVjyTiH9tQ72uXrn2voF56eZESnM4rEwrY98 --url devnet
```

Deploy only after confirming the correct funded deployer:

```bash
solana program deploy target/deploy/scenario_capsule.so \
  --program-id ~/.config/kelvara/scenario-capsule-keypair.json \
  --url devnet \
  -k <FUNDED-DEVNET-DEPLOYER.json>
```

Do not use `anchor deploy`. Preserve the external program keypair.

## Implemented application slice

- Server-only Anchor client: initialize, trigger, reset, confirmed slot/time fingerprints.
- Bounded API: one active session per client, TTL, ownership, idempotent triggers.
- Staged professional UI: wallet familiarization → Saturn Earn deposit → naked-position warning → Kelvara discovery/protection → exploit proof.
- Saturn Earn APY is 7.2%; deposit amount is user-selected.
- Sandbox USDC is a genuine six-decimal SPL token at `AXujHvVHXE3G7XcRrmcbhBH63cVk1jCHTnnCiuuQMooE`. It is not Circle-issued USDC and has no value.
- Deposit moves genuine SPL tokens from the browser wallet to a position-PDA-owned vault.
- The browser signs both protection activation and a durable-nonce evacuation transaction. The server never receives the burner secret key.
- Evacuation is gated by active scenario flags, armed protection, and an unused position. Tokens can return only to the position owner; a fixed 1% fee routes to the sponsor treasury token account.
- Fake transaction signatures and browser-only balances were removed.
- Confirmed Devnet evidence normalization and Alert Console publishing.
- Real server startup fails closed without `DEVNET_SPONSOR_KEYPAIR`.

Start after deployment and funding:

```bash
DEVNET_SPONSOR_KEYPAIR=<server-keypair.json> \
DEVNET_USDC_MINT_KEYPAIR=<sandbox-mint-keypair.json> \
DEVNET_RPC_URL=<devnet-rpc-url> \
ALERT_CONSOLE_URL=http://127.0.0.1:7623 \
npm start
```

Current live services:

- Guided Devnet demo: `http://127.0.0.1:7640`
- Dedicated durable demo Alert Console: `http://127.0.0.1:7624`

Verified live fingerprint:

- Session PDA: `BXGuMCg4VevLdzcktt6y7A9jyW3MjhRQR5gNU9Rk3463`
- Initialize slot: `504429860`
- Compound trigger slot: `504429872`; three rules breached and three alerts opened.
- Reset slot: `504429876`; all three rules passed and all three alerts resolved.

Verified v2 live journey:

- Program upgrade transaction: `4aeBedCGVY4DaD2ECCp8ohZKRJUtyn5fLjVaD2QciC5cxHnJ6n6MBykYjM51QJf3fzM3XSzRLWd1jaHdXjSaaFD1`.
- Test wallet: `9iHbHaX7ySgoHjxdavwxxJHpte9ZNebzaXGx8joe1Xd1`.
- Session PDA: `9p5akSVa64TgDhSqQkdcGXzruETUFB6LVR3Ajd76CFig`.
- Position PDA: `8LbkqyCZ4uGzxnVVeNcye48ERLLsvso6nHDw8DVg3HAe`.
- Durable nonce: `EJSKKr7neUoLmSJSNedSbsQpdQwTRQZrQkn8HGJS1ciV`.
- Deposit transaction: `PU8nJtmrEdv4JibgUUbCQ5AjEjbLCnX9Mm7AiYjqvaXvXBZ2LhZEH9jHHNgGBK9q1Sqy16XkKmfqPWXYBxRKY5N`.
- Protection activation: `4oDwMHW97Qknv6bYxEtUxCzrw6GpSZiA76SKCmNXNbMY5j8p1RKdrYS4VGn3v6suV9ycsuM4eu9KzuPEc5XqQRu5`.
- Breach transaction: `5fQWkbq4jKj2PKqD1yEJpKhpWTwfM4D346Rtoe9Mo9jn79jkUBJYf7FLJY1Ubjj6jYp1749FBy2ycsXdACuY2bLQ`.
- Durable-nonce evacuation: `49xVL7kEAGnQj438cxrv7ajY5D5josnLaWcyjLoB3g6z7NsVmsLL29QdaanPVv8jGnnmcR6ajUzviPcgasVTChej`.
- Final wallet balance: `992.5 USDC` after depositing `750`, evacuating `742.5`, and settling the fixed `7.5 USDC` fee.

Public Devnet RPC confirmation can time out after successful submission. The server recovers the submitted signature and queries its confirmed transaction fingerprint before returning a result.

Before broad public exposure, put the server behind TLS and durable/distributed rate limiting. The current in-process one-session-per-client control protects a single process only.

## Security boundaries

- Sponsor key remains server-side.
- Browser receives no RPC credentials or signing material.
- Only predefined scenario flags are accepted.
- TTL maximum is five minutes.
- Program enforces sponsor ownership of each session.
- Public API still needs rate limiting before Internet exposure.
- Current program is a monitoring demo, not ONRE financial logic.
