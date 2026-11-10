"""Run the Sentinel CLI in an isolated, resource-limited subprocess.

Isolation:
* ``python -I -B``: isolated mode (no PYTHON* env vars, no user site, no
  script-dir on sys.path) and no bytecode writes;
* ``env={}``: the child sees no PayPal, LLM, HMAC or any other secret;
* rlimits: ``RLIMIT_CPU=2s``, ``RLIMIT_AS=256MB``, ``RLIMIT_FSIZE=2MB``,
  ``RLIMIT_NOFILE=32``, ``RLIMIT_CORE=0``;
* the CLI disables the socket layer before reading input;
* a 5 s wall-clock timeout.

Any crash, timeout, limit hit or unparsable output is a VETO (fail closed).
"""

from __future__ import annotations

import asyncio
import json
import resource
import subprocess
import sys
from pathlib import Path
from typing import Any

CLI_PATH = Path(__file__).with_name("cli.py")
CPU_SECONDS = 2
ADDRESS_SPACE_BYTES = 256 * 1024 * 1024
FILE_SIZE_BYTES = 2 * 1024 * 1024
OPEN_FILES = 32
WALL_TIMEOUT_SECONDS = 5.0


def _limit_child() -> None:  # pragma: no cover - runs in the child process
    resource.setrlimit(resource.RLIMIT_CPU, (CPU_SECONDS, CPU_SECONDS))
    resource.setrlimit(resource.RLIMIT_AS, (ADDRESS_SPACE_BYTES, ADDRESS_SPACE_BYTES))
    resource.setrlimit(resource.RLIMIT_FSIZE, (FILE_SIZE_BYTES, FILE_SIZE_BYTES))
    resource.setrlimit(resource.RLIMIT_NOFILE, (OPEN_FILES, OPEN_FILES))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))


def _fail_closed(reason: str, code: str = "VETO_SANDBOX_RESOURCE_LIMIT") -> dict[str, Any]:
    return {
        "verdict": "VETO",
        "exit_code": 2,
        "veto_codes": [code],
        "reasons": [reason],
        "proposal_id": "",
        "dispute_id": "",
        "manifest_sha256": "0" * 64,
        "hmac_approval_token": None,
    }


def command(script: Path = CLI_PATH) -> list[str]:
    return [sys.executable, "-I", "-B", str(script)]


def run_sync(payload: bytes, *, script: Path = CLI_PATH) -> tuple[int, dict[str, Any]]:
    """Evaluate raw proposal bytes; returns (exit_code, verdict)."""
    try:
        completed = subprocess.run(
            command(script),
            input=payload,
            capture_output=True,
            env={},
            cwd="/",
            timeout=WALL_TIMEOUT_SECONDS,
            preexec_fn=_limit_child,
            check=False,
        )
    except subprocess.TimeoutExpired:
        return 2, _fail_closed("sentinel exceeded the wall-clock limit")
    try:
        verdict = json.loads(completed.stdout.decode("utf-8") or "{}")
    except (UnicodeDecodeError, json.JSONDecodeError):
        verdict = {}
    if completed.returncode not in (0, 2) or not isinstance(verdict, dict) or not verdict:
        return 2, _fail_closed(f"sentinel exited abnormally (code {completed.returncode})")
    if completed.returncode == 0 and verdict.get("verdict") != "ALLOW":
        return 2, _fail_closed("sentinel exit code and verdict disagree", "VETO_SCHEMA_INVALID")
    return completed.returncode, verdict


async def run(proposal: dict[str, Any] | bytes) -> tuple[int, dict[str, Any]]:
    """Async wrapper (the subprocess runs in a worker thread)."""
    payload = (
        proposal
        if isinstance(proposal, bytes)
        else json.dumps(proposal, sort_keys=True).encode("utf-8")
    )
    return await asyncio.to_thread(run_sync, payload)
