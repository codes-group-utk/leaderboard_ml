#!/usr/bin/env python3
"""Fetch leaderboard for a given day and save JSON+CSV snapshot locally."""

from __future__ import annotations

import argparse
import csv
import json
from datetime import datetime, timezone
from pathlib import Path

import requests


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT_DIR = REPO_ROOT / "data" / "leaderboard_snapshots"


def default_date() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def fetch_leaderboard(api_base: str, date: str, limit: int) -> dict:
    url = api_base.rstrip("/") + "/api/leaderboard"
    response = requests.get(url, params={"date": date, "limit": limit}, timeout=60)
    try:
        body = response.json()
    except ValueError:
        body = {"raw": response.text}

    if response.status_code >= 300:
        raise RuntimeError(f"Failed to fetch leaderboard ({response.status_code}): {body}")

    return body


def save_snapshot(data: dict, out_dir: Path) -> tuple[Path, Path]:
    date = data.get("date", "unknown-date")
    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")

    target = out_dir / date
    target.mkdir(parents=True, exist_ok=True)

    json_path = target / f"leaderboard_{ts}.json"
    csv_path = target / f"leaderboard_{ts}.csv"

    json_path.write_text(json.dumps(data, indent=2), encoding="utf-8")

    entries = data.get("entries", [])
    with csv_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["rank", "name", "group", "score", "total_error", "correct_cases", "created_at"])
        for i, row in enumerate(entries, start=1):
            writer.writerow(
                [
                    i,
                    row.get("name", ""),
                    row.get("group_name", ""),
                    row.get("score", ""),
                    row.get("total_error", ""),
                    row.get("correct_cases", ""),
                    row.get("created_at", ""),
                ]
            )

    return json_path, csv_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Save daily leaderboard snapshot locally.")
    parser.add_argument("--api-base", required=True, help="Worker base URL, e.g. https://x.workers.dev")
    parser.add_argument("--date", default=default_date(), help="Date in YYYY-MM-DD (UTC by default)")
    parser.add_argument("--limit", type=int, default=500, help="Max leaderboard rows to fetch")
    parser.add_argument(
        "--out-dir",
        default=str(DEFAULT_OUT_DIR),
        help="Output directory for snapshots",
    )
    args = parser.parse_args()

    data = fetch_leaderboard(args.api_base, args.date, args.limit)
    json_path, csv_path = save_snapshot(data, Path(args.out_dir).resolve())

    print(f"Saved leaderboard JSON: {json_path}")
    print(f"Saved leaderboard CSV:  {csv_path}")


if __name__ == "__main__":
    main()
