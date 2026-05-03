#!/usr/bin/env python3
"""ad_orders cleanup — undo what ad_orders_plant.py did.

Deletes the fixture rows (matched by ``notes`` prefix ``ad_orders
fixture``), their amendment rows (matched by ``reason`` prefix), and
the snapshot file. Idempotent. Does NOT touch real (non-fixture) data.
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

SNAPSHOT_PATH = WHRB / "cache" / "ad_orders_snapshot.json"
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

MARKER = "ad_orders fixture"


def _client():
    return create_client(SUPABASE_URL, SERVICE_KEY)


def main() -> int:
    snapshot: dict = {}
    if SNAPSHOT_PATH.exists():
        snapshot = json.loads(SNAPSHOT_PATH.read_text())

    if not (SUPABASE_URL and SERVICE_KEY):
        if SNAPSHOT_PATH.exists():
            SNAPSHOT_PATH.unlink()
            print("OK snapshot removed; no DB creds — DB cleanup skipped.")
        return 0

    sb = _client()
    deleted_amendments = 0
    deleted_rows = 0

    # Amendments first (FK on ad_orders is RESTRICT).
    res = sb.table("ad_order_amendments").delete().like("reason", f"{MARKER}%").execute()
    deleted_amendments = len(res.data or [])

    # Then snapshot rows by id.
    for f in snapshot.get("fixtures", []):
        fid = f.get("id")
        if not fid:
            continue
        sb.table("ad_orders").delete().eq("id", fid).execute()
        deleted_rows += 1

    # Belt-and-suspenders sweep by marker.
    res = sb.table("ad_orders").delete().like("notes", f"{MARKER}%").execute()
    deleted_rows += len(res.data or [])

    if SNAPSHOT_PATH.exists():
        SNAPSHOT_PATH.unlink()
    print(f"OK cleanup complete. amendments_deleted={deleted_amendments} rows_deleted={deleted_rows}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
