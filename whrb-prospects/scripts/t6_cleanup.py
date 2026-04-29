#!/usr/bin/env python3
"""Stage T6 cleanup — undo what t6_plant.py did.

Deletes the 2 fixture prospects (Boston Symphony Orchestra and Harvard
Glee Club planted with ``created_source='manual'`` and the ``t6 fixture``
marker in ``pipeline_notes``). Idempotent — safe to re-run.

Cascades:
  * prospect_tags rows attached to the deleted prospects (FK cascade
    in 007_tag_schema.sql).

Does NOT touch:
  * tests/fixtures/t6/ — fixture HTML stays committed.
  * source_config rows (managed by db.supabase_sync.seed_source_config).
  * tag_vocabulary rows from migration 016 (use --rollback there if
    you need to back the vocab out).
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

SNAPSHOT_PATH = WHRB / "cache" / "t6_snapshot.json"
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
    # Belt-and-suspenders: also delete any leftover fixture row that
    # carries the t6 marker (e.g. if a prior run lost the snapshot).
    sb.table("prospects").delete().like(
        "pipeline_notes", "t6 fixture%"
    ).execute()
    if SNAPSHOT_PATH.exists():
        SNAPSHOT_PATH.unlink()
    print(f"OK cleanup complete. deleted={deleted}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
