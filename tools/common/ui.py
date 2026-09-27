import argparse
import json
import sys


def row(label, value):
    return f"{label:<24} {value}"


def heading(title, output):
    print(title, file=output)
    print("=" * len(title), file=output)


def api_failure(error, output):
    print(f"API unavailable: {error}", file=output)
    print("Start the Node evidence API in another terminal: npm start", file=output)
    return 1


def ask_wallet(wallet, input_fn=input):
    return (wallet or input_fn("Public Solana wallet address: ")).strip()


def print_json(value, output):
    print(json.dumps(value, indent=2), file=output)
