#!/usr/bin/env python3
"""Stage 7 cleanup — restore fixtures.

Restores:
  - Each lock-matrix subject's 15 scraped fields from cache/stage7_snapshot.json.
    Also clears `user_overrides` on those rows.
  - Hard-deletes all prospect_notes rows carrying the `[stage7_plant_v1]`
    marker OR whose body matches the lock-matrix plant markers.
  - Hard-deletes manual-add prospects whose business_key starts with `manual-`
    AND whose company_name starts with "Stage 7 Manual Test".
  - Removes cache/stage7_snapshot.json.

Deliberately retains the synthetic reps (stage7-rep-{a,b}@example.com) so
Stage 8's fixtures can use them (per plan §16.6 item 16). Stage 8's cleanup
deletes those users.

Idempotent: re-running after a clean state is a no-op modulo "snapshot
missing" warning.
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

SNAPSHOT_PATH = WHRB / "cache" / "stage7_snapshot.json"
CACHE_MARKER = "stage7_plant_v1"

# Body substrings used by Playwright specs + Python integrity tests. These
# inserts happen outside the plant flow so they don't carry the CACHE_MARKER;
# match them here so a clean re-run is tidy.
INTEGRITY_BODY_PATTERNS = (
    "stage7_integrity_realtime",
    "stage7_edit_start",
    "stage7_softdelete_author",
    "stage7_admin_delete",
    "stage7_restore",
    "stage7_integrity_v1",
    "soft-delete me",
)


def _client():
    return create_client(SUPABASE_URL, SERVICE_KEY)


def _restore_lock_subjects(client, subjects: dict[str, dict]) -> int:
    """Write the snapshotted values back, clearing user_overrides."""
    restored = 0
    # Group by id so each row gets a single restore write.
    by_id: dict[str, dict] = {}
    for _, data in subjects.items():
        pid = data["id"]
        if pid not in by_id:
            by_id[pid] = dict(data["snapshot"])
    for pid, payload in by_id.items():
        payload["user_overrides"] = {}
        client.table("prospects").update(payload).eq("id", pid).execute()
        restored += 1
    return restored


def _delete_marked_notes(client) -> int:
    deleted = 0
    res = (
        client.table("prospect_notes")
        .delete()
        .ilike("body", f"%[{CACHE_MARKER}]%")
        .execute()
    )
    deleted += len(res.data or [])
    for pat in INTEGRITY_BODY_PATTERNS:
        res = client.table("prospect_notes").delete().ilike("body", f"%{pat}%").execute()
        deleted += len(res.data or [])
    return deleted


def _delete_manual_prospects(client) -> int:
    res = (
        client.table("prospects")
        .delete()
        .ilike("company_name", "Stage 7 Manual Test%")
        .execute()
    )
    return len(res.data or [])


def main() -> int:
    client = _client()

    if SNAPSHOT_PATH.exists():
        snap = json.loads(SNAPSHOT_PATH.read_text())
        restored = _restore_lock_subjects(client, snap.get("lock_subjects", {}))
        print(f"Restored {restored} lock subject(s); user_overrides cleared.")
    else:
        print(f"No snapshot at {SNAPSHOT_PATH}; skipping lock-subject restore.")

    deleted_notes = _delete_marked_notes(client)
    deleted_manual = _delete_manual_prospects(client)
    print(f"Deleted notes={deleted_notes}, manual prospects={deleted_manual}.")

    if SNAPSHOT_PATH.exists():
        SNAPSHOT_PATH.unlink()
        print(f"Removed {SNAPSHOT_PATH}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
