#!/usr/bin/env python3
import argparse
import sys
from pathlib import Path

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from urllib.parse import quote

from tools.common.api import ApiError, HttpApi
from tools.common.ui import api_failure, ask_wallet, heading, row


def run(api, wallet=None, output=sys.stdout, input_fn=input):
    heading("M3 — Wallet discovery", output)
    wallet = ask_wallet(wallet, input_fn)
    print("Connection model: public-address inspection only. No signature or wallet permission.", file=output)
    try:
        result = api.get(f"/api/wallets/{quote(wallet, safe='')}/positions")
    except ApiError as error:
        return api_failure(error, output)
    print(row("Wallet", result.get("wallet", wallet)), file=output)
    print(row("RPC agreement", result.get("sourceStatus", "unknown")), file=output)
    for source in result.get("sources", []):
        print(row(f"  {source.get('name')}", source.get("status")), file=output)
    positions = result.get("positions", [])
    if not positions:
        print("No supported ONYC position found.", file=output)
        return 0
    for position in positions:
        print(row("Position", f"{position.get('amount')} {position.get('asset')}"), file=output)
        print(row("Mint", position.get("mint")), file=output)
        print(row("Token accounts", len(position.get("tokenAccounts", []))), file=output)
    return 0


def main():
    parser = argparse.ArgumentParser(description="M3: discover a wallet's ONYC position")
    parser.add_argument("wallet", nargs="?")
    parser.add_argument("--api", default="http://127.0.0.1:7610")
    args = parser.parse_args()
    raise SystemExit(run(HttpApi(args.api), args.wallet))


if __name__ == "__main__":
    main()
