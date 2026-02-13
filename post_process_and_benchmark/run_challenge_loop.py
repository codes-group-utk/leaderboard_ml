#!/usr/bin/env python3
"""Continuously rotate challenge data at a fixed interval.

Cycle steps:
1) Pull/save current leaderboard snapshot.
2) Generate random cases and publish new challenge data.
3) Optionally clear submissions for challenge date on each publish.
4) Repeat every interval forever (or for N iterations).
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from fetch_leaderboard_snapshot import fetch_leaderboard, save_snapshot


SCRIPT_DIR = Path(__file__).resolve().parent
SCRIPT_REPO_ROOT = SCRIPT_DIR.parents[0]


def utc_date() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def parse_interval(raw: str) -> int:
    s = raw.strip().lower()
    if not s:
        raise ValueError("Interval cannot be empty.")

    unit = s[-1]
    if unit in {"s", "m", "h"}:
        value = float(s[:-1])
    else:
        value = float(s)
        unit = "s"

    if value <= 0:
        raise ValueError("Interval must be > 0")

    factor = {"s": 1, "m": 60, "h": 3600}[unit]
    return int(value * factor)


def run_create_challenge(
    *,
    api_base: str,
    admin_token: str,
    date: str,
    repo_root: Path,
    num_cases: int,
    batch_size: int,
    seed: int | None,
    reset_submissions: bool,
    skip_sim: bool,
) -> None:
    cmd = [
        sys.executable,
        str(SCRIPT_DIR / "create_daily_challenge.py"),
        "--api-base",
        api_base,
        "--admin-token",
        admin_token,
        "--date",
        date,
        "--repo-root",
        str(repo_root),
        "--num-cases",
        str(num_cases),
        "--batch-size",
        str(batch_size),
        "--csv",
        str(repo_root / "data" / "daily_cases.csv"),
    ]
    if seed is not None:
        cmd.extend(["--seed", str(seed)])
    if reset_submissions:
        cmd.append("--reset-submissions")
    if skip_sim:
        cmd.append("--skip-sim")

    subprocess.run(cmd, check=True)


def try_snapshot(api_base: str, date: str, out_dir: Path, label: str) -> None:
    try:
        data = fetch_leaderboard(api_base, date, limit=1000)
        target = out_dir / label
        json_path, csv_path = save_snapshot(data, target)
        print(f"[{label}] snapshot saved -> {json_path}")
        print(f"[{label}] snapshot saved -> {csv_path}")
    except Exception as exc:  # noqa: BLE001
        print(f"[{label}] snapshot failed: {exc}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Run continuous challenge rotation loop.")
    parser.add_argument("--api-base", required=True, help="Worker base URL, e.g. https://x.workers.dev")
    parser.add_argument(
        "--admin-token",
        default=os.environ.get("LEADERBOARD_ADMIN_TOKEN", ""),
        help="Admin token (or set LEADERBOARD_ADMIN_TOKEN env var)",
    )
    parser.add_argument(
        "--repo-root",
        default=os.environ.get("LEADERBOARD_LOCAL_REPO_ROOT", str(SCRIPT_REPO_ROOT)),
        help="Full local repo root containing driver.py/GRID/simulation/data",
    )
    parser.add_argument(
        "--interval",
        default="24h",
        help="Loop interval (examples: 300, 300s, 5m, 2h). Default 24h",
    )
    parser.add_argument("--num-cases", type=int, default=10, help="Random cases per cycle")
    parser.add_argument("--batch-size", type=int, default=10, help="Parallel simulations per cycle")
    parser.add_argument("--seed", type=int, default=None, help="Optional fixed seed")
    parser.add_argument(
        "--date-mode",
        choices=["utc", "fixed"],
        default="utc",
        help="Use current UTC date each cycle or a fixed date",
    )
    parser.add_argument("--fixed-date", default="", help="Required when --date-mode fixed")
    parser.add_argument(
        "--snapshot-dir",
        default="",
        help="Where to save per-cycle snapshots (default: <repo-root>/data/loop_snapshots)",
    )
    parser.add_argument(
        "--iterations",
        type=int,
        default=0,
        help="0 = infinite loop, otherwise run N cycles and stop",
    )
    parser.add_argument(
        "--no-reset-submissions",
        action="store_true",
        help="Do not clear existing submissions for cycle date before republishing",
    )
    parser.add_argument(
        "--skip-sim",
        action="store_true",
        help="Skip CFD and republish from existing CSV (<repo-root>/data/daily_cases.csv)",
    )
    args = parser.parse_args()

    if not args.admin_token:
        raise SystemExit("Missing admin token. Provide --admin-token or LEADERBOARD_ADMIN_TOKEN env var.")

    repo_root = Path(args.repo_root).resolve()
    if not (repo_root / "driver.py").is_file():
        raise SystemExit(f"driver.py not found in repo-root: {repo_root}")

    interval_seconds = parse_interval(args.interval)
    if args.date_mode == "fixed" and not args.fixed_date:
        raise SystemExit("--fixed-date is required when --date-mode fixed")

    snapshot_root = Path(args.snapshot_dir).resolve() if args.snapshot_dir else (repo_root / "data" / "loop_snapshots")
    snapshot_root.mkdir(parents=True, exist_ok=True)

    cycle_index = 0
    while True:
        cycle_index += 1
        cycle_start = time.time()
        cycle_stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")

        date = args.fixed_date if args.date_mode == "fixed" else utc_date()
        cycle_dir = snapshot_root / date / cycle_stamp
        cycle_dir.mkdir(parents=True, exist_ok=True)

        print("=" * 80)
        print(f"Cycle {cycle_index} started at {cycle_stamp} UTC for date {date}")

        # 1) Pull and save current leaderboard before reset/publish.
        try_snapshot(args.api_base, date, cycle_dir, "pre_publish")

        # 2) Publish new challenge data (and reset submissions by default).
        reset_submissions = not args.no_reset_submissions
        try:
            run_create_challenge(
                api_base=args.api_base,
                admin_token=args.admin_token,
                date=date,
                repo_root=repo_root,
                num_cases=args.num_cases,
                batch_size=args.batch_size,
                seed=args.seed,
                reset_submissions=reset_submissions,
                skip_sim=args.skip_sim,
            )
            print("Publish cycle succeeded.")
        except Exception as exc:  # noqa: BLE001
            print(f"Publish cycle failed: {exc}")

        # 3) Pull and save post-publish leaderboard state.
        try_snapshot(args.api_base, date, cycle_dir, "post_publish")

        if args.iterations > 0 and cycle_index >= args.iterations:
            print(f"Completed {cycle_index} cycle(s). Exiting.")
            break

        elapsed = time.time() - cycle_start
        sleep_for = max(1, interval_seconds - int(elapsed))
        print(f"Sleeping {sleep_for} seconds before next cycle...")
        time.sleep(sleep_for)


if __name__ == "__main__":
    main()
