# Kelvara Kamino Monitor

Non-custodial production MVP for one exact Kamino Earn position: **Steakhouse USDG High Yield**.

## Expected interaction

1. Deposit USDG into the exact vault through Kamino.
2. Open Kelvara and connect a browser wallet, or paste its public address.
3. Public-address inspection is view-only. Connecting a wallet is explicit and separate.
4. The backend queries Kamino's wallet-position endpoint and selects only vault `BoZDRc1RDY9FzUZZ19WT4GbtTnnbXQ8AGSU5ByEw3ut5`.
5. If shares exist, the UI shows staked/unstaked shares and estimated USDG using the current tokens-per-share rate.
6. The backend independently fetches the kVault Program and ProgramData accounts from Solana Mainnet.
7. The UI shows the current upgrade authority and compares it with the deployment baseline.
8. A mismatch is displayed as an authority alert. It means program-upgrade control changed; it is not by itself proof of compromise.
9. After monitoring activation, a connected wallet can prepare a full evacuation. Kelvara obtains the unsigned withdrawal from Kamino, constrains its programs/accounts/instruction sequence, simulates it, and displays destination and fees before enabling signing.
10. Signing and submission require an explicit wallet approval. Kelvara submits once, checks the signature before any send, and never automatically re-signs or resends an uncertain withdrawal.

Durable nonce transactions are intentionally not used. A durable nonce is consumed once; it cannot provide reusable signatures or support silently increasing priority fees. Priority fee changes rebuild and re-simulate the unsigned transaction before a fresh wallet approval.

A USDG wallet balance is not a Kamino position. The wallet must own or stake shares from this exact vault.

## Fixed production identities

| Item | Address |
|---|---|
| Vault | `BoZDRc1RDY9FzUZZ19WT4GbtTnnbXQ8AGSU5ByEw3ut5` |
| Share mint | `4hKmkq2SkthLPceEBJXpyvH9m9PvNpFwasoB8mZgJ6rE` |
| USDG mint | `2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH` |
| kVault program | `KvauGMspG5k6rtzrqqn7WNn3oZdyKqLKwK2XWQ8FLjd` |
| ProgramData | `GeZ7nkkcbJ6VVV1XVFbmFnLCY3F1LPBGk6cufDZvrbGn` |

## Local production-wallet app

```bash
cd '/home/andycore/hackaton/[HACKATON]/kelvara-onre'
./subapps/kamino-monitor/start.sh
```

Open `http://127.0.0.1:7650/#`.

Port `7640` remains reserved for the simulation demo. The production app remains separate under `subapps/kamino-monitor/` for later merging.

## Docker deployment

```bash
cp .env.production.example .env.production
# Set MONITORED_WALLET to a public address.
# Prefer a private/keyed server-side RPC for reliable production polling.
docker compose --env-file .env.production up -d --build
```

Open `http://SERVER:8080`. Health: `/healthz`.

Do not put a seed phrase, private key, wallet file, signing service, or unrestricted browser RPC key in the environment. Wallet signing stays client-side. The server validates and relays only the narrowly constrained evacuation transaction.

## API

- `GET /healthz`
- `GET /api/config`
- `GET /api/status`
- `GET /api/inspect/:wallet`
- `POST /api/evacuation/prepare`
- `POST /api/evacuation/submit`
- `GET /api/evacuation/status/:signature`

## Evidence limitations

- Position/share data: Kamino API.
- Program authority: Solana RPC account bytes, decoded independently.
- Default public RPC is suitable for evaluation, not reliable production load.
- Monitor state is in memory. Restart causes a fresh baseline comparison against the pinned expected authority.
