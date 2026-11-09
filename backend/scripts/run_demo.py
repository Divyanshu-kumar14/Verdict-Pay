#!/usr/bin/env python
"""Boot a clean demo stack: reset the DB, seed it, start the API, run the E2E flow.

    uv run python scripts/run_demo.py [--port 8000] [--keep]

Uses the PayPal Sandbox credentials from .env (PAYPAL_SANDBOX_CLIENT_ID/SECRET or
PAYPAL_CLIENT_ID/SECRET). Checkouts are real sandbox orders; no real money moves.
"""

from __future__ import annotations

import argparse
import os
import socket
import subprocess
import sys
import time
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
DEMO_DIR = BACKEND_DIR / ".demo"
DEMO_DB = DEMO_DIR / "verdictpay.db"


def port_is_free(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.bind(("127.0.0.1", port))
        except OSError:
            return False
    return True


def run(command: list[str], env: dict[str, str]) -> None:
    result = subprocess.run(command, cwd=BACKEND_DIR, env=env, check=False)
    if result.returncode != 0:
        raise SystemExit(f"command failed ({result.returncode}): {' '.join(command)}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=int(os.environ.get("API_PORT", "8000")))
    parser.add_argument(
        "--keep", action="store_true", help="keep the server running after the demo"
    )
    args = parser.parse_args()

    if not port_is_free(args.port):
        raise SystemExit(f"port {args.port} is busy - pick another with --port")

    DEMO_DIR.mkdir(parents=True, exist_ok=True)
    for suffix in ("", "-wal", "-shm"):
        candidate = Path(str(DEMO_DB) + suffix)
        if candidate.exists():
            candidate.unlink()

    relative_db = DEMO_DB.relative_to(BACKEND_DIR).as_posix()
    env = {
        **os.environ,
        "DATABASE_URL": f"sqlite+aiosqlite:///./{relative_db}",
        "PAYPAL_MODE": "PAYPAL_SANDBOX",
        "APP_ENV": "local",
        "PYTHONUNBUFFERED": "1",
        "LOG_LEVEL": "WARNING",
    }

    print("==> seeding demo data")
    run([sys.executable, "scripts/seed_demo.py", "--reset"], env)

    print(f"==> starting API on http://127.0.0.1:{args.port}")
    server = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "uvicorn",
            "app.main:app",
            "--host",
            "127.0.0.1",
            "--port",
            str(args.port),
            "--log-level",
            "warning",
        ],
        cwd=BACKEND_DIR,
        env=env,
    )

    try:
        deadline = time.time() + 30
        healthy = False
        while time.time() < deadline:
            if server.poll() is not None:
                raise SystemExit(f"API exited during boot with code {server.returncode}")
            time.sleep(0.25)
            try:
                import httpx

                response = httpx.get(
                    f"http://127.0.0.1:{args.port}/api/v1/health", timeout=1
                )
                if response.status_code == 200:
                    healthy = True
                    break
            except Exception:
                continue
        if not healthy:
            raise SystemExit("API did not become healthy within 30s")

        print("==> running the judge flow")
        run(
            [sys.executable, "scripts/e2e_demo.py"],
            {**env, "VERDICTPAY_BASE_URL": f"http://127.0.0.1:{args.port}"},
        )
        print(f"\n==> demo ready: API http://127.0.0.1:{args.port} - frontend: make web")
        if args.keep:
            print("    (server kept alive - Ctrl-C to stop)")
            server.wait()
    finally:
        if server.poll() is None:
            server.terminate()
            try:
                server.wait(timeout=5)
            except subprocess.TimeoutExpired:
                server.kill()


if __name__ == "__main__":
    main()
