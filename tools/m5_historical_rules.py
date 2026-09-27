#!/usr/bin/env python3
import argparse
import sys
from pathlib import Path

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from tools.common.api import ApiError, HttpApi
from tools.common.ui import api_failure, heading, row


def run(api, output=sys.stdout):
    heading("M5 — Historical rules", output)
    try:
        source = api.get("/api/sources/onre-indexer")
    except ApiError as error:
        return api_failure(error, output)
    counts = source.get("counts", {})
    freshness = source.get("freshness", {})
    print(row("Source freshness", freshness.get("status", "unknown")), file=output)
    print(row("Processed history", counts.get("processed", 0)), file=output)
    print(row("Pending history", counts.get("pending", 0)), file=output)
    print("\nStatus: NOT IMPLEMENTED", file=output)
    print("The shared live/history rule evaluator and evidence-linked replay endpoint do not exist yet.", file=output)
    print("No replay was performed. No breach or near-threshold claim is being made.", file=output)
    print("Next proof: implement one rule once, run it against current state and indexed history, then expose reproducible evidence IDs.", file=output)
    return 3


def main():
    parser = argparse.ArgumentParser(description="M5: show historical-rule implementation readiness")
    parser.add_argument("--api", default="http://127.0.0.1:7610")
    args = parser.parse_args()
    raise SystemExit(run(HttpApi(args.api)))


if __name__ == "__main__":
    main()
