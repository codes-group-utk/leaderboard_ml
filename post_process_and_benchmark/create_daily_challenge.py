#!/usr/bin/env python3
"""Run daily random simulations and publish today's challenge to the API."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

# Reuse the publish utility you already have.
from publish_daily_cases import load_cases, publish


SCRIPT_REPO_ROOT = Path(__file__).resolve().parents[1]


def default_date() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def run_driver(repo_root: Path, output_csv: Path, num_cases: int, batch_size: int, seed: int | None) -> None:
    cmd = [
        sys.executable,
        str(repo_root / "driver.py"),
        "--num-cases",
        str(num_cases),
        "--batch-size",
        str(batch_size),
        "--output-csv",
        str(output_csv),
    ]
    if seed is not None:
        cmd.extend(["--seed", str(seed)])

    print("Running daily simulation batch...")
    print("Command:", " ".join(cmd))
    subprocess.run(cmd, cwd=repo_root, check=True)


def archive_outputs(data_root: Path, date: str, csv_path: Path, publish_result: dict) -> Path:
    out_dir = data_root / "daily_challenges" / date
    out_dir.mkdir(parents=True, exist_ok=True)

    archived_csv = out_dir / "daily_cases.csv"
    shutil.copy2(csv_path, archived_csv)

    response_file = out_dir / "publish_response.json"
    response_file.write_text(json.dumps(publish_result, indent=2), encoding="utf-8")

    return out_dir


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Create daily challenge: random sims + publish to leaderboard API"
    )
    parser.add_argument("--api-base", required=True, help="Worker base URL, e.g. https://x.workers.dev")
    parser.add_argument(
        "--admin-token",
        default=os.environ.get("LEADERBOARD_ADMIN_TOKEN", ""),
        help="Admin token (or set LEADERBOARD_ADMIN_TOKEN env var)",
    )
    parser.add_argument("--date", default=default_date(), help="Challenge date in YYYY-MM-DD (UTC)")
    parser.add_argument("--num-cases", type=int, default=10, help="Number of random cases")
    parser.add_argument("--batch-size", type=int, default=10, help="Parallel simulations")
    parser.add_argument("--seed", type=int, default=None, help="Optional random seed")
    parser.add_argument(
        "--csv",
        default="",
        help="Output CSV path for driver results (default: <repo-root>/data/daily_cases.csv)",
    )
    parser.add_argument(
        "--repo-root",
        default=os.environ.get("LEADERBOARD_LOCAL_REPO_ROOT", str(SCRIPT_REPO_ROOT)),
        help="Full local repo root containing driver.py, GRID, simulation, and data",
    )
    parser.add_argument(
        "--skip-sim",
        action="store_true",
        help="Skip running driver.py and only publish an existing CSV",
    )
    args = parser.parse_args()

    if not args.admin_token:
        raise SystemExit("Missing admin token. Provide --admin-token or LEADERBOARD_ADMIN_TOKEN env var.")

    repo_root = Path(args.repo_root).resolve()
    data_root = repo_root / "data"

    if not (repo_root / "driver.py").is_file() and not args.skip_sim:
        raise SystemExit(f"driver.py not found under repo root: {repo_root}")

    csv_path = Path(args.csv).resolve() if args.csv else (data_root / "daily_cases.csv")

    if not args.skip_sim:
        run_driver(repo_root, csv_path, args.num_cases, args.batch_size, args.seed)
    elif not csv_path.is_file():
        raise SystemExit(f"--skip-sim was used but CSV does not exist: {csv_path}")

    cases = load_cases(csv_path)
    publish_result = publish(args.api_base, args.admin_token, args.date, cases)

    out_dir = archive_outputs(data_root, args.date, csv_path, publish_result)
    print(json.dumps(publish_result, indent=2))
    print(f"Archived daily challenge data under: {out_dir}")


if __name__ == "__main__":
    main()
