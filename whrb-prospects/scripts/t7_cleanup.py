#!/usr/bin/env python3
"""Stage T7 cleanup — undo what t7_plant.py did.

Deletes the dedupe-test prospects (matched by ``pipeline_notes`` prefix
``t7 fixture``). Idempotent. Does NOT touch fixtures, source_config,
or tag_vocabulary — those are managed separately.
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

SNAPSHOT_PATH = WHRB / "cache" / "t7_snapshot.json"
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")


def _client():
    return create_client(SUPABASE_URL, SERVICE_KEY)


def main() -> int:
    snapshot: dict = {}
    if SNAPSHOT_PATH.exists():
        snapshot = json.loads(SNAPSHOT_PATH.read_text())

    if not (SUPABASE_URL and SERVICE_KEY):
        # No DB creds — still clear the snapshot so plant can re-run.
        if SNAPSHOT_PATH.exists():
            SNAPSHOT_PATH.unlink()
            print("OK snapshot removed; no DB creds — DB cleanup skipped.")
        return 0

    sb = _client()
    deleted = 0
    for p in snapshot.get("prospects", []):
        pid = p.get("id")
        if not pid:
            continue
        sb.table("prospects").delete().eq("id", pid).execute()
        deleted += 1
    # Belt-and-suspenders: also delete any leftover fixture row tagged
    # with the t7 marker, in case the snapshot was lost.
    sb.table("prospects").delete().like(
        "pipeline_notes", "t7 fixture%"
    ).execute()
    if SNAPSHOT_PATH.exists():
        SNAPSHOT_PATH.unlink()
    print(f"OK cleanup complete. deleted={deleted}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
