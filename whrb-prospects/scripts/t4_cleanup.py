#!/usr/bin/env python3
"""Stage T4 cleanup — reverse of t4_plant.py. Idempotent: every delete
uses ``in_(…)`` against snapshot UUIDs and tolerates already-deleted
rows.
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

SUPABASE_URL = os.environ["SUPABASE_URL"]
SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

SNAPSHOT_PATH = WHRB / "cache" / "t4_snapshot.json"


def _client():
    return create_client(SUPABASE_URL, SERVICE_KEY)


def main() -> int:
    if not SNAPSHOT_PATH.exists():
        print(f"No snapshot at {SNAPSHOT_PATH}; nothing to clean.")
        return 0
    snap = json.loads(SNAPSHOT_PATH.read_text())
    sb = _client()

    sold_ids = list(snap.get("sold_prospect_ids") or [])
    if sold_ids:
        sb.table("prospects").delete().in_("id", sold_ids).execute()
    if snap.get("impr_anchor"):
        sb.table("prospects").delete().eq("id", snap["impr_anchor"]).execute()
    if snap.get("bso_id"):
        sb.table("prospects").delete().eq("id", snap["bso_id"]).execute()

    impression_ids = list(snap.get("impression_ids") or [])
    if impression_ids:
        sb.table("filter_impressions").delete().in_("id", impression_ids).execute()

    dedupe_ids = list(snap.get("dedupe_event_ids") or [])
    if dedupe_ids:
        sb.table("event_log").delete().in_("id", dedupe_ids).execute()

    backdated_ids = list((snap.get("backdated_event_ids") or {}).values())
    if backdated_ids:
        sb.table("event_log").delete().in_("id", backdated_ids).execute()

    transitional_keys = list(snap.get("transitional_source_keys") or [])
    if transitional_keys:
        sb.table("source_config").delete().in_(
            "source_key", transitional_keys
        ).execute()

    if snap.get("changelog_id"):
        sb.table("changelog_entries").delete().eq(
            "id", snap["changelog_id"]
        ).execute()

    rep_id = snap.get("rep_id")
    if rep_id:
        # Best-effort delete the synthetic rep so the next plant gets a
        # fresh users row. Tolerate failures (e.g., deleted elsewhere).
        try:
            sb.auth.admin.delete_user(rep_id)
        except Exception as e:
            print(f"warn: could not delete rep {rep_id}: {e}")

    SNAPSHOT_PATH.unlink()
    print("Cleanup complete; snapshot removed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
