#!/usr/bin/env python3
"""Stage T7 — offline ingest of T7-source fixtures into Supabase.

Drives the existing ``db.supabase_sync.sync()`` path with the rows each
T7 source emits from its hand-crafted fixture (offline mode). Mirrors
what a live pipeline run would do for the T7 sources only — the goal
is to populate ``prospects`` with rows whose ``source`` column matches
each new T7 key so the C9 ``rows_last_run > 0`` half of the integrity
matrix flips green.

Usage:
    .venv/bin/python scripts/t7_ingest_offline.py
"""
from __future__ import annotations

import importlib
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

HERE = Path(__file__).resolve().parent
WHRB = HERE.parent
sys.path.insert(0, str(WHRB))
load_dotenv(WHRB / ".env")

# Force offline mode so every T7 module reads from its committed fixture.
os.environ["WHRB_T7_OFFLINE"] = "1"

from db.supabase_sync import seed_source_config, sync  # noqa: E402
from enrich.dedupe import dedupe  # noqa: E402
from scripts.t7_source_manifest import T7_SOURCE_MANIFEST  # noqa: E402


def main() -> int:
    seed_source_config()
    print(f"=== T7 offline ingest (via existing sync path) ===")

    all_rows: list[dict] = []
    per_source_counts: dict[str, int] = {}
    for spec in T7_SOURCE_MANIFEST:
        mod = importlib.import_module(f"sources.{spec.module}")
        try:
            rows = mod.run_all()
        except Exception as exc:
            print(f"  ! {spec.source_key}: run_all raised {type(exc).__name__}: {exc}")
            continue
        per_source_counts[spec.source_key] = len(rows)
        all_rows.extend(rows)
        print(f"  - {spec.source_key}: {len(rows)} rows")

    # Run the same dedupe pass `pipeline.py` runs before sync.
    deduped = dedupe(all_rows)
    print(f"  total raw: {len(all_rows)} → deduped: {len(deduped)}")

    summary = sync(deduped)
    print()
    print("Sync summary:")
    for k, v in summary.items():
        print(f"  {k}: {v}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
