import os
import subprocess
from dataclasses import dataclass
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]


@dataclass
class CommandResult:
    code: int
    output: str


class SubprocessRunner:
    def run(self, command, environment=None):
        env = os.environ.copy()
        env.update(environment or {})
        completed = subprocess.run(
            command,
            cwd=PROJECT_ROOT,
            env=env,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            check=False,
        )
        return CommandResult(completed.returncode, completed.stdout)


class MemoryRunner:
    def __init__(self, results):
        self.results = list(results)
        self.commands = []
        self.environments = []

    def run(self, command, environment=None):
        self.commands.append(list(command))
        self.environments.append(dict(environment or {}))
        return self.results.pop(0)
