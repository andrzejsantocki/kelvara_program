# Verified wallet linkage contract

Program Backend publishes only after `POST /api/auth/verify` validates the real Solana Ed25519 signature. Production requires dedicated `KELVARA_WALLET_LINK_URL` and `KELVARA_WALLET_LINK_TOKEN`; token must differ from all other service tokens.

## Control Plane endpoint

`POST /internal/v1/wallet-links`

`Authorization: Bearer <KELVARA_WALLET_LINK_TOKEN>`

Request JSON, exactly:

```json
{
  "schemaVersion": "verified-wallet-link/v1",
  "chain": "solana",
  "network": "mainnet-beta",
  "walletAddress": "<base58 address>",
  "verification": {
    "method": "solana-wallet-signature",
    "verifiedAt": "<ISO-8601>",
    "challengeId": "<sha256 evidence ID>"
  },
  "idempotencyKey": "<sha256 event ID>"
}
```

Allowed response: `{ "accepted": true }` or `{ "accepted": true, "idempotent": true }`. Any timeout, non-2xx, malformed response, or unexpected field fails closed. Session issuance waits for acceptance.

Replay with the same idempotency key and identical event is accepted. Same key with any changed event conflicts.

Challenge text, nonce, signature bytes, session token, keys, and secrets never enter this request or logs. Network is explicit and bound into the issued challenge; default production route is `mainnet-beta`.
