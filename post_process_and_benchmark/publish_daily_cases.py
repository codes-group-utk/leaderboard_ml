#!/usr/bin/env python3
"""Publish daily benchmark cases to the worker admin endpoint.

Reads driver.py output CSV and posts hidden CL/CD + public inputs.
"""

import argparse
import csv
import json
from datetime import datetime, timezone
from pathlib import Path

import requests


def default_date() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def load_cases(csv_path: Path) -> list[dict]:
    if not csv_path.is_file():
        raise FileNotFoundError(f"CSV not found: {csv_path}")

    cases = []
    with csv_path.open(newline="") as f:
        reader = csv.DictReader(f)
        for idx, row in enumerate(reader, start=1):
            status = (row.get("status") or "").strip().upper()
            if status != "OK":
                continue

            try:
                coords = json.loads(row.get("coordinates_json") or "[]")
            except json.JSONDecodeError as exc:
                raise ValueError(f"Invalid coordinates_json on row {idx}: {exc}") from exc

            case = {
                "case_id": len(cases) + 1,
                "airfoil": (row.get("airfoil") or "").strip(),
                "mach": float(row["mach"]),
                "reynolds": float(row["reynolds"]),
                "aoa": float(row["aoa"]),
                "coordinates": coords,
                "cl": float(row["cl"]),
                "cd": float(row["cd"]),
            }
            cases.append(case)

    if len(cases) == 0:
        raise RuntimeError("No successful cases found (status=OK) in CSV.")

    return cases


def publish(api_base: str, admin_token: str, date: str, cases: list[dict]) -> dict:
    url = api_base.rstrip("/") + "/api/admin/publish"
    payload = {"date": date, "cases": cases}
    headers = {
        "Authorization": f"Bearer {admin_token}",
        "Content-Type": "application/json",
    }

    response = requests.post(url, headers=headers, json=payload, timeout=120)
    try:
        body = response.json()
    except ValueError:
        body = {"raw": response.text}

    if response.status_code >= 300:
        raise RuntimeError(f"Publish failed ({response.status_code}): {body}")

    return body


def main() -> None:
    parser = argparse.ArgumentParser(description="Publish daily cases to leaderboard API.")
    parser.add_argument("--csv", required=True, help="Path to driver output CSV")
    parser.add_argument("--api-base", required=True, help="Worker base URL, e.g. https://x.workers.dev")
    parser.add_argument("--admin-token", required=True, help="Admin token for publish endpoint")
    parser.add_argument("--date", default=default_date(), help="Date in YYYY-MM-DD (UTC by default)")
    args = parser.parse_args()

    csv_path = Path(args.csv).resolve()
    cases = load_cases(csv_path)
    result = publish(args.api_base, args.admin_token, args.date, cases)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
