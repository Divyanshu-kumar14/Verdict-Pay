"""Sentinel CLI: reads one TriageProposal JSON on stdin, prints the verdict.

Exit code 0 = ALLOW, 2 = VETO. Designed to run as
``python -I -B app/sentinel/cli.py`` with an empty environment and resource
limits (see ``sandbox_runner``). Before any input is read the socket layer is
disabled, so nothing evaluated here can reach the network, and JSON floats
abort with ``VETO_FLOAT_PRECISION_REJECTED``.
"""

from __future__ import annotations

import json
import socket
import sys
from pathlib import Path


def _block_network() -> None:
    def _refuse(*_args: object, **_kwargs: object) -> None:
        raise OSError("network access is disabled inside the Sentinel")

    socket.socket = _refuse  # type: ignore[assignment,misc]
    socket.create_connection = _refuse  # type: ignore[assignment]
    socket.getaddrinfo = _refuse  # type: ignore[assignment]


def main() -> int:
    _block_network()
    # -I drops the script directory from sys.path; add the backend root only.
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
    from app.oracle.money import FloatRejectedError, strict_loads
    from app.sentinel.gate import EXIT_VETO, evaluate

    raw = sys.stdin.read(2 * 1024 * 1024)
    try:
        proposal = strict_loads(raw)
    except FloatRejectedError as exc:
        verdict = {
            "verdict": "VETO",
            "exit_code": EXIT_VETO,
            "veto_codes": ["VETO_FLOAT_PRECISION_REJECTED"],
            "reasons": [str(exc)],
            "proposal_id": "",
            "dispute_id": "",
            "manifest_sha256": "0" * 64,
            "hmac_approval_token": None,
        }
        sys.stdout.write(json.dumps(verdict))
        return EXIT_VETO
    except ValueError:
        verdict = {
            "verdict": "VETO",
            "exit_code": EXIT_VETO,
            "veto_codes": ["VETO_SCHEMA_INVALID"],
            "reasons": ["proposal is not valid JSON"],
            "proposal_id": "",
            "dispute_id": "",
            "manifest_sha256": "0" * 64,
            "hmac_approval_token": None,
        }
        sys.stdout.write(json.dumps(verdict))
        return EXIT_VETO
    verdict = evaluate(proposal)
    sys.stdout.write(json.dumps(verdict, sort_keys=True))
    return int(verdict["exit_code"])


if __name__ == "__main__":
    raise SystemExit(main())
