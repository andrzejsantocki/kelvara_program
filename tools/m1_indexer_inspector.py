#!/usr/bin/env python3
import argparse
import sys
from pathlib import Path

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from tools.common.api import ApiError, HttpApi
from tools.common.ui import api_failure, heading, row


def run(api, output=sys.stdout):
    heading("M1 — Indexer inspector", output)
    try:
        source = api.get("/api/sources/onre-indexer")
    except ApiError as error:
        return api_failure(error, output)
    if not source.get("available"):
        print(row("Source", f"unavailable: {source.get('reason', 'unknown')}"), file=output)
        return 2
    schema = source.get("schema", {})
    counts = source.get("counts", {})
    freshness = source.get("freshness", {})
    head = source.get("head") or {}
    print(row("Access", source.get("access", "unknown")), file=output)
    print(row("Schema compatible", "yes" if schema.get("compatible") else "no"), file=output)
    print(row("Signatures", counts.get("signatures", 0)), file=output)
    print(row("Processed", counts.get("processed", 0)), file=output)
    print(row("Pending", counts.get("pending", 0)), file=output)
    print(row("Failed", counts.get("failed", 0)), file=output)
    print(row("Head slot", head.get("slot", "unknown")), file=output)
    print(row("Freshness", f"{freshness.get('status', 'unknown')} ({freshness.get('ageSeconds', '?')}s old)"), file=output)
    if schema.get("problems"):
        print(row("Schema problems", "; ".join(schema["problems"])), file=output)
    print("Verdict: evidence source inspected without modifying its database.", file=output)
    return 0 if schema.get("compatible") else 2


def main():
    parser = argparse.ArgumentParser(description="M1: inspect the ONRE indexer read-only source")
    parser.add_argument("--api", default="http://127.0.0.1:7610")
    args = parser.parse_args()
    raise SystemExit(run(HttpApi(args.api)))


if __name__ == "__main__":
    main()
