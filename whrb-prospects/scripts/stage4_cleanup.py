#!/usr/bin/env python3
"""Stage 4 teardown — undo the manual-override plant.

Restores the override row to its original ``is_nonprofit`` / ``ein`` /
``nonprofit_source`` values and removes the ``is_nonprofit`` key from
``user_overrides`` (preserving any other pre-existing overrides). Idempotent.
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

SNAPSHOT_PATH = WHRB / "cache" / "stage4_snapshot.json"


def main() -> int:
    if not SNAPSHOT_PATH.exists():
        print(f"[stage4-cleanup] no snapshot at {SNAPSHOT_PATH}; nothing to do")
        return 0
    snapshot = json.loads(SNAPSHOT_PATH.read_text())
    ov = snapshot["override_row"]
    client = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])
    res = (
        client.table("prospects")
        .select("id,user_overrides")
        .eq("id", ov["id"])
        .execute()
    )
    if not res.data:
        print(f"[stage4-cleanup] override row {ov['id']} gone; skipping")
        return 0
    current_overrides = dict((res.data[0].get("user_overrides") or {}))
    current_overrides.pop("is_nonprofit", None)
    patch = {
        "is_nonprofit": ov["original_is_nonprofit"],
        "ein": ov["original_ein"],
        "nonprofit_source": ov["original_nonprofit_source"],
        "user_overrides": current_overrides,
    }
    client.table("prospects").update(patch).eq("id", ov["id"]).execute()
    print(f"[stage4-cleanup] restored {ov['id']} -> {patch}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
