#!/usr/bin/env python3
"""Stage T3 cleanup — undo t3_plant.py.

Order of operations (FK-safe):
  1. DELETE notifications referencing the pending vocab fixtures.
  2. DELETE prospect_tags rows on the fixture prospect.
  3. DELETE the fixture pending vocab rows.
  4. DELETE the fixture prospect.
  5. Hard-delete the synthetic rep accounts (admin is preserved).
  6. Remove cache/t3_snapshot.json.

Idempotent: missing snapshot is treated as already-cleaned.
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

SNAPSHOT_PATH = WHRB / "cache" / "t3_snapshot.json"


def main() -> int:
    if not SNAPSHOT_PATH.exists():
        print("No t3_snapshot.json — already clean.")
        return 0

    snapshot = json.loads(SNAPSHOT_PATH.read_text())
    sb = create_client(SUPABASE_URL, SERVICE_KEY)

    # 1) Delete notifications referencing the planted pending vocabs.
    pending_vocab_ids = list(snapshot.get("pending_vocab_ids", {}).values())
    if pending_vocab_ids:
        # PostgREST has no straight `payload->>'tag_id' in (...)` filter via
        # the python client, so iterate.
        for vid in pending_vocab_ids:
            try:
                sb.table("notifications").delete().eq("kind", "tag_vocab_pending").contains(
                    "payload", {"tag_id": vid}
                ).execute()
            except Exception as e:
                print(f"  warn: notification cleanup for vocab {vid}: {e}")

    # 2) Delete prospect_tags rows on the fixture prospect (the FK on the
    # prospect_id is ON DELETE CASCADE so step 4 would also clear them; we
    # do it explicitly here so the audit trigger fires while the prospect
    # still exists, matching the trigger semantics rep workflows hit).
    prospect_id = snapshot.get("prospect_id")
    if prospect_id:
        sb.table("prospect_tags").delete().eq("prospect_id", prospect_id).execute()

    # 3) Delete the fixture pending vocab rows.
    if pending_vocab_ids:
        sb.table("tag_vocabulary").delete().in_("id", pending_vocab_ids).execute()

    # 4) Delete the fixture prospect.
    if prospect_id:
        sb.table("prospects").delete().eq("id", prospect_id).execute()

    # 5) Delete synthetic rep accounts.
    for key in ("rep_a_id", "rep_b_id"):
        rep_id = snapshot.get(key)
        if not rep_id:
            continue
        try:
            sb.auth.admin.delete_user(rep_id)
        except Exception as e:
            print(f"  warn: failed to delete user {rep_id}: {e}")

    # 6) Drop the snapshot.
    SNAPSHOT_PATH.unlink()
    print("Cleanup complete.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
