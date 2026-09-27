#!/usr/bin/env python3
import argparse
import sys
from pathlib import Path

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from tools.common.runtime import SubprocessRunner
from tools.common.ui import heading


def run(runner, action=None, limit=25, output=sys.stdout, input_fn=input):
    heading("M2 — Bounded ingestion runner", output)
    if action is None:
        print("1. Show status\n2. Run one bounded cycle\n3. Exit", file=output)
        choice = input_fn("Choose: ").strip()
        action = {"1": "status", "2": "run", "3": "exit"}.get(choice, "invalid")
    if action == "exit":
        return 0
    if action not in {"status", "run"}:
        print("Invalid choice.", file=output)
        return 2
    if action == "run":
        print(f"Running one cycle; maximum pending transactions: {limit}", file=output)
        result = runner.run(["npm", "run", "ingest:once"], {"KELVARA_PROCESS_LIMIT": str(limit)})
        if result.code:
            print(result.output, file=output)
            return result.code
    status = runner.run(["npm", "run", "ingest:status"])
    print(status.output.strip(), file=output)
    return status.code


def main():
    parser = argparse.ArgumentParser(description="M2: run or inspect bounded ONRE ingestion")
    parser.add_argument("--action", choices=["status", "run"])
    parser.add_argument("--limit", type=int, default=25)
    args = parser.parse_args()
    if args.limit < 1:
        parser.error("--limit must be positive")
    raise SystemExit(run(SubprocessRunner(), args.action, args.limit))


if __name__ == "__main__":
    main()
