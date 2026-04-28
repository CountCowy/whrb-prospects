#!/usr/bin/env python3
"""Stage T5 cleanup — undo what t5_plant.py did.

Deletes the 2 fixture prospects ('Boston Symphony Orchestra' and 'WBUR
CitySpace' planted with `created_source='manual'` and the t5 marker in
`pipeline_notes`). Idempotent — safe to re-run after every integrity
session.

Cascades:
  - prospect_tags rows attached to the deleted prospects (FK
    on delete cascade in 007_tag_schema.sql).

Does NOT touch:
  - peer_stations rows (admin-managed, persists between runs).
  - source_config rows (managed by db.supabase_sync.seed_source_config).
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

HERE = Path(__file__).resolve().parent
WHRB = HERE.parent
sys.path.insert(0, str(WHRB))
load_dotenv(WHRB / ".env")

SNAPSHOT_PATH = WHRB / "cache" / "t5_snapshot.json"
SUPABASE_URL = os.environ["SUPABASE_URL"]
SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]


def _client():
    return create_client(SUPABASE_URL, SERVICE_KEY)


def main() -> int:
    sb = _client()
    snapshot: dict = {}
    if SNAPSHOT_PATH.exists():
        snapshot = json.loads(SNAPSHOT_PATH.read_text())
    deleted = 0
    for p in snapshot.get("prospects", []):
        pid = p.get("id")
        if not pid:
            continue
        sb.table("prospects").delete().eq("id", pid).execute()
        deleted += 1
    # Belt-and-suspenders: also delete by pipeline_notes marker so a
    # snapshot file lost on a previous run still leaves no fixture
    # rows behind.
    sb.table("prospects").delete().like(
        "pipeline_notes", "t5 fixture%"
    ).execute()
    if SNAPSHOT_PATH.exists():
        SNAPSHOT_PATH.unlink()
    print(f"OK cleanup complete. deleted={deleted}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
