import io
import subprocess
import sys
import unittest
from pathlib import Path

from tools.common.api import ApiError, MemoryApi
from tools.common.runtime import CommandResult, MemoryRunner
from tools.m1_indexer_inspector import run as run_m1
from tools.m2_ingestion_runner import run as run_m2
from tools.m3_wallet_discovery import run as run_m3
from tools.m4_current_assurance import run as run_m4
from tools.m5_historical_rules import run as run_m5

WALLET = "11111111111111111111111111111111"


def output_of(function, **kwargs):
    output = io.StringIO()
    code = function(output=output, **kwargs)
    return code, output.getvalue()


class MilestoneCliTests(unittest.TestCase):
    def test_m1_reports_schema_counts_and_truthful_freshness(self):
        api = MemoryApi({"/api/sources/onre-indexer": {
            "available": True,
            "access": "read-only",
            "schema": {"compatible": True, "problems": []},
            "counts": {"signatures": 100, "processed": 80, "pending": 20, "failed": 0},
            "head": {"slot": 42, "signature": "sig"},
            "freshness": {"status": "stale", "ageSeconds": 99, "reason": "source_age_exceeded"},
        }})
        code, text = output_of(run_m1, api=api)
        self.assertEqual(code, 0)
        self.assertIn("M1 — Indexer inspector", text)
        self.assertIn("Schema compatible", text)
        self.assertIn("stale", text)
        self.assertIn("Pending", text)
        self.assertIn("read-only", text)

    def test_m2_runs_one_bounded_cycle_then_displays_status(self):
        runner = MemoryRunner([
            CommandResult(0, "cycle ok"),
            CommandResult(0, "Runner state idle\nPending 19\nCatch-up bounded per cycle"),
        ])
        code, text = output_of(run_m2, runner=runner, action="run", limit=1)
        self.assertEqual(code, 0)
        self.assertEqual(runner.commands[0][-2:], ["run", "ingest:once"])
        self.assertEqual(runner.environments[0]["KELVARA_PROCESS_LIMIT"], "1")
        self.assertIn("Pending 19", text)
        self.assertIn("bounded", text)

    def test_m3_discovers_wallet_without_requesting_signature(self):
        api = MemoryApi({f"/api/wallets/{WALLET}/positions": {
            "wallet": WALLET, "sourceStatus": "verified",
            "sources": [{"name": "rpc-1", "status": "ok"}],
            "positions": [{"asset": "ONYC", "amount": "12.5", "mint": "mint", "tokenAccounts": []}],
        }})
        code, text = output_of(run_m3, api=api, wallet=WALLET)
        self.assertEqual(code, 0)
        self.assertIn("12.5 ONYC", text)
        self.assertIn("verified", text)
        self.assertIn("No signature", text)

    def test_m4_shows_controls_and_unknown_coverage(self):
        api = MemoryApi({f"/api/wallets/{WALLET}/assurance": {
            "position": {"asset": "ONYC", "amount": "2"},
            "assurance": {
                "sourceStatus": "verified",
                "program": {"deploymentSlot": 42, "upgradeAuthority": "upgrade"},
                "token": {"supply": "1000", "mintAuthority": "mint", "freezeAuthority": "freeze"},
                "conclusion": "No monitored control condition is currently breached.",
                "monitors": [{"id": "protocol-nav", "status": "unavailable", "reason": "not attached"}],
            },
        }})
        code, text = output_of(run_m4, api=api, wallet=WALLET)
        self.assertEqual(code, 0)
        self.assertIn("Upgrade authority", text)
        self.assertIn("UNAVAILABLE", text)
        self.assertNotIn("Everything is safe", text)

    def test_m5_is_honest_until_shared_historical_evaluator_exists(self):
        api = MemoryApi({"/api/sources/onre-indexer": {
            "available": True, "counts": {"processed": 80, "pending": 20},
            "freshness": {"status": "stale"},
        }})
        code, text = output_of(run_m5, api=api)
        self.assertEqual(code, 3)
        self.assertIn("NOT IMPLEMENTED", text)
        self.assertIn("No replay was performed", text)
        self.assertIn("20", text)

    def test_api_failure_has_actionable_message(self):
        api = MemoryApi(error=ApiError("connection refused"))
        code, text = output_of(run_m1, api=api)
        self.assertEqual(code, 1)
        self.assertIn("npm start", text)

    def test_each_cli_can_run_as_a_script_from_inside_tools(self):
        tools_dir = Path(__file__).resolve().parents[1]
        for script in [
            "m1_indexer_inspector.py",
            "m2_ingestion_runner.py",
            "m3_wallet_discovery.py",
            "m4_current_assurance.py",
            "m5_historical_rules.py",
        ]:
            completed = subprocess.run(
                [sys.executable, script, "--help"],
                cwd=tools_dir,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                check=False,
            )
            self.assertEqual(completed.returncode, 0, f"{script}: {completed.stdout}")
            self.assertIn("usage:", completed.stdout)


if __name__ == "__main__":
    unittest.main()
