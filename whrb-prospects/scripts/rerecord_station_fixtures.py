#!/usr/bin/env python3
"""Quarterly fixture re-capture for sources/competitor_stations.

Re-fetches each of the 5 station sponsor pages and their robots.txt with
the WHRB User-Agent + the standard 5s rate limit, then writes them to
``tests/fixtures/competitor_stations/<slug>_sponsors.html`` and
``<slug>_robots.txt``.

After re-capture, run ``pytest tests/sources/test_competitor_stations.py``
and ``scripts/t5_integrity.py``. Any parser drift surfaces as a test
failure; update the per-station parsers in ``sources/competitor_stations.py``
and bump the T5 ROLLOUT entry with the date + diff.

Per-quarter usage:
    .venv/bin/python scripts/rerecord_station_fixtures.py
    .venv/bin/python scripts/rerecord_station_fixtures.py --diff-only
"""
from __future__ import annotations

import argparse
import difflib
import sys
import time
from pathlib import Path

import requests

HERE = Path(__file__).resolve().parent
WHRB = HERE.parent
sys.path.insert(0, str(WHRB))

from sources.competitor_stations import (
    _STATION_CONFIGS,
    RATE_LIMIT_SECONDS,
    USER_AGENT,
)

FIXTURE_DIR = WHRB / "tests" / "fixtures" / "competitor_stations"


def _fetch(url: str) -> tuple[int, str]:
    resp = requests.get(
        url,
        headers={"User-Agent": USER_AGENT},
        timeout=30,
        allow_redirects=True,
    )
    return resp.status_code, resp.text


def _diff(old_path: Path, new_text: str) -> str:
    if not old_path.exists():
        return f"(new file; {len(new_text):,} bytes)"
    old_lines = old_path.read_text(errors="replace").splitlines(keepends=True)
    new_lines = new_text.splitlines(keepends=True)
    delta = list(
        difflib.unified_diff(
            old_lines, new_lines, fromfile=str(old_path), tofile="<live>", n=1
        )
    )
    if not delta:
        return "(unchanged)"
    return "".join(delta[:60])


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--diff-only",
        action="store_true",
        help="Print diff vs. on-disk fixtures without writing.",
    )
    args = ap.parse_args()

    FIXTURE_DIR.mkdir(parents=True, exist_ok=True)

    summary: list[str] = []
    for i, (slug, cfg) in enumerate(_STATION_CONFIGS.items()):
        if i > 0:
            time.sleep(RATE_LIMIT_SECONDS)
        for kind, url in (
            ("robots", cfg["robots_url"]),
            ("sponsors", cfg["sponsor_url"]),
        ):
            target_name = (
                f"{slug}_robots.txt" if kind == "robots" else f"{slug}_sponsors.html"
            )
            target = FIXTURE_DIR / target_name
            try:
                status, body = _fetch(url)
            except Exception as exc:
                summary.append(f"{slug:5s} {kind:8s} FAIL {type(exc).__name__}: {exc}")
                continue
            if kind == "robots" and status >= 400:
                # Convention: 4xx on robots = "no robots.txt published".
                # Stash a sentinel rather than the 4xx HTML body.
                body = f"# {url} returned HTTP {status} — treated as no restrictions.\n"
            elif status >= 400:
                summary.append(
                    f"{slug:5s} {kind:8s} HTTP {status} — fixture NOT updated"
                )
                continue
            diff = _diff(target, body)
            if args.diff_only:
                summary.append(f"{slug:5s} {kind:8s} HTTP {status}")
                if diff and diff != "(unchanged)":
                    print(f"\n=== {target_name} ===")
                    print(diff)
            else:
                target.write_text(body, encoding="utf-8")
                size = len(body)
                summary.append(
                    f"{slug:5s} {kind:8s} HTTP {status}  {size:>7,}b  {diff[:60]}"
                )
        # Inter-page sleep within station for politeness.
        if i < len(_STATION_CONFIGS) - 1:
            time.sleep(RATE_LIMIT_SECONDS)

    print("\nSummary:")
    for line in summary:
        print(f"  {line}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
