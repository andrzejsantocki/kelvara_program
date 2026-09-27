# Kelvara Contract Inspector

Small white-mode UI for testing the shared evidence and event contracts.

## Start

From the repository root:

```bash
node subapps/contract-inspector/server.js
```

Open `http://127.0.0.1:4312`.

Optional port:

```bash
CONTRACT_INSPECTOR_PORT=4400 node subapps/contract-inspector/server.js
```

## Test visually

1. Click **Mainnet** and **Devnet**. Confirm the selected network and displayed redacted RPC provider change.
2. Keep the sample evidence unchanged. Click **Validate evidence**. Expect `VALID`.
3. Change `cluster` to `testnet`. Expect `INVALID` with a cluster error.
4. Change evidence `state` to `stale`. It remains valid evidence, but downstream health conclusions cannot become healthy.
5. Keep the sample devnet event. Click **Validate event**. Expect `VALID`.
6. Select Mainnet. The event switches from `fixture_simulation` to `live`; validate again.
7. On a Mainnet event, manually set `mode` to `fixture_simulation`. Expect `INVALID`.
8. Delete `recommendedAction` or empty `evidenceIds`. Expect `INVALID`.
9. Resize the browser to mobile width. Cards should stack without horizontal scrolling.

## Network configuration

```bash
KELVARA_NETWORK=devnet \
KELVARA_DEVNET_RPC_URLS=https://api.devnet.solana.com \
node subapps/contract-inspector/server.js
```

```bash
KELVARA_NETWORK=mainnet-beta \
KELVARA_MAINNET_RPC_URLS=https://api.mainnet-beta.solana.com \
node subapps/contract-inspector/server.js
```

Comma-separate multiple RPC URLs. The UI/API returns redacted provider origins, never credentials or query strings.

## API

- `GET /api/health`
- `GET /api/network?cluster=devnet`
- `POST /api/validate/evidence`
- `POST /api/validate/event`
