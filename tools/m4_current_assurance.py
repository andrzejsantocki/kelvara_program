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
    heading("M4 — Current assurance", output)
    wallet = ask_wallet(wallet, input_fn)
    try:
        result = api.get(f"/api/wallets/{quote(wallet, safe='')}/assurance")
    except ApiError as error:
        return api_failure(error, output)
    position = result.get("position", {})
    assurance = result.get("assurance", {})
    program = assurance.get("program", {})
    token = assurance.get("token", {})
    print(row("Position", f"{position.get('amount')} {position.get('asset')}"), file=output)
    print(row("RPC agreement", assurance.get("sourceStatus", "unknown")), file=output)
    print(row("Deployment slot", program.get("deploymentSlot")), file=output)
    print(row("Upgrade authority", program.get("upgradeAuthority") or "none (immutable)"), file=output)
    print(row("ONYC supply", token.get("supply")), file=output)
    print(row("Mint authority", token.get("mintAuthority") or "none"), file=output)
    print(row("Freeze authority", token.get("freezeAuthority") or "none"), file=output)
    print("\nMonitor coverage", file=output)
    for monitor in assurance.get("monitors", []):
        print(row(monitor.get("id"), f"{monitor.get('status', 'unknown').upper()} — {monitor.get('reason')}"), file=output)
    print(f"\nConclusion: {assurance.get('conclusion')}", file=output)
    print("Scope warning: this conclusion covers listed monitors only; unavailable checks remain unknown.", file=output)
    return 0


def main():
    parser = argparse.ArgumentParser(description="M4: inspect current ONRE and ONYC controls")
    parser.add_argument("wallet", nargs="?")
    parser.add_argument("--api", default="http://127.0.0.1:7610")
    args = parser.parse_args()
    raise SystemExit(run(HttpApi(args.api), args.wallet))


if __name__ == "__main__":
    main()
