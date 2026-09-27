---
name: kelvara-devnet-demo
description: Operate Kelvara's isolated live Devnet demo.
version: 0.1.0
author: Andrzej Santocki, Hermes Agent
license: MIT
platforms: [linux, macos]
metadata:
  hermes:
    tags: [solana, devnet, anchor, demo]
    related_skills: []
---

# Kelvara Devnet Demo Skill

Operate the real-chain Scenario Capsule without confusing local fixtures with Devnet evidence. Deployment and sponsorship remain explicit operator actions.

## When to Use

- Build or deploy the Scenario Capsule program.
- Run the public guided Devnet introduction.
- Diagnose session, transaction, monitoring, or reset failures.
- Do not use for Fixture Lab; that producer is synthetic and separately labeled.

## Prerequisites

- Anchor 0.32.x, Solana CLI, Rust, Node.js 20+.
- A funded Devnet deployer and sponsor keypair.
- Alert Console running with the intended Devnet rules active.
- `DEVNET_SPONSOR_KEYPAIR` points to a server-only JSON keypair.
- `DEVNET_RPC_URL` is a server-side Devnet RPC URL.
- Program keypair remains outside the repository at `~/.config/kelvara/scenario-capsule-keypair.json`.

## How to Run

Use `terminal` from `devnet-demo/`:

```text
cargo test --workspace
anchor build
npm test
npm run check
```

After deployment, start:

```text
DEVNET_SPONSOR_KEYPAIR=<server-keypair.json> \
DEVNET_RPC_URL=<devnet-rpc-url> \
ALERT_CONSOLE_URL=http://127.0.0.1:7623 \
npm start
```

Open `http://127.0.0.1:7640`.

## Procedure

1. Verify `cargo test --workspace`, `anchor build`, `npm test`, and `npm run check` all pass. Completion: `.so` and IDL exist.
2. Check deployer balance with `terminal(command="solana balance --url devnet")`. Completion: enough Devnet SOL exists for program deployment.
3. Deploy exactly one artifact with `solana program deploy`; never use broad `anchor deploy`. Completion: `solana program show <PROGRAM_ID> --url devnet` reports the expected authority.
4. Start Alert Console. Publish and explicitly activate the demo rules. Completion: `/api/rules` shows intended versions active.
5. Start the demo server with server-only sponsor and RPC configuration. Completion: `/api/health` reports `cluster: devnet` and the correct program ID.
6. Run one capsule: initialize, compound trigger, Explorer proof, monitoring result, reset. Completion: all three transaction signatures resolve on Devnet Explorer.
7. Check automatic expiry separately. Completion: expired account state is interpreted as baseline; immutable historical signatures remain visible.

## Trust Boundaries

- A transaction counts as live only after confirmed Devnet transaction lookup returns a slot.
- Evidence uses `cluster: devnet` and `source.type: monitoring_backend`.
- Fixture RPC output never enters this path.
- Publishing rules never activates them.
- Sponsor keys and unrestricted RPC credentials never enter browser assets, logs, docs, or Git.
- Blockchain history is not reverted. TTL causes logical baseline restoration; reset creates another real transaction.

## Pitfalls

- `0 SOL` blocks deployment and session rent. Fund Devnet first; do not report deployment.
- Public faucet rate limits are common. Use the official faucet or transfer Devnet SOL from another funded development wallet.
- Deleting the external program keypair loses the program identity permanently.
- Public API needs reverse-proxy TLS and distributed rate limiting before broad Internet exposure. Current in-process per-client limit is not enough for multi-instance hosting.
- Anchor 0.32.1 brings npm advisories without available upstream fixes. Keep request bodies bounded and avoid parsing user TOML; reassess dependencies before production.
- Expiry is logical. A keeper-triggered reset is optional and costs a transaction.

## Verification

- Rust unit tests pass.
- Anchor BPF build and IDL generation pass.
- Node client/server tests pass.
- Syntax checks pass.
- Program ID in IDL, `declare_id!`, `Anchor.toml`, and external keypair match.
- Devnet `program show` succeeds after deployment.
- Explorer links resolve for initialize, trigger, and reset.
- Alert Console receives evidence linked to the confirmed signature and slot.
- Restart does not silently claim active visitor sessions; each new visitor gets a new PDA.
