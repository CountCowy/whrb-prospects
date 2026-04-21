#!/usr/bin/env python3
"""Stage 10 cleanup — revert the 5 planted edits + tear down synthetic rep.

Reads cache/stage10_snapshot.json and:

  1. Reverts pickup_state[0] (assign only) back to pre_assigned_to.
  2. Reverts pickup_state[1] (state only) back to pre_state.
  3. Reverts phone_lock[0] phone + clears user_overrides.company_phone.
  4. Hard-deletes the seeded note (note_id).
  5. Reverts nonprofit_lock[0] flag/source/ein + clears user_overrides keys.
  6. Hard-deletes the synthetic rep (stage10-rep@example.com).
  7. Removes cache/stage10_snapshot.json.

Probe-fired pipeline_runs rows (scheduled, forced-failure, success) are
INTENTIONALLY KEPT per round-10 §21.5 item 16 — they form the audit trail
for Stage 10's ROLLOUT exit entry.

Idempotent: tolerates missing snapshot (performs only step 6 via email
lookup) and tolerates already-reverted edits.

Usage:
  .venv/bin/python scripts/stage10_cleanup.py [--keep-users]
"""
from __future__ import annotations

import argparse
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

CACHE_DIR = WHRB / "cache"
SNAPSHOT_PATH = CACHE_DIR / "stage10_snapshot.json"

STAGE10_REP = "stage10-rep@example.com"


def _client():
    return create_client(SUPABASE_URL, SERVICE_KEY)


def _find_profile_id(client, email: str) -> str | None:
    res = (
        client.table("profiles")
        .select("id")
        .ilike("email", email)
        .limit(1)
        .execute()
    )
    rows = res.data or []
    if rows:
        return rows[0]["id"]
    return None


def _delete_user(client, email: str) -> bool:
    uid = _find_profile_id(client, email)
    if not uid:
        return False
    try:
        client.table("profiles").update({"deactivated_at": None}).eq("id", uid).execute()
    except Exception:
        pass
    try:
        client.auth.admin.delete_user(uid)
        return True
    except Exception as exc:
        print(f"warn: could not delete {email} ({uid}): {exc}", file=sys.stderr)
        return False


def _revert_pickup_assign(client, entry: dict) -> None:
    client.table("prospects").update(
        {"assigned_to": entry.get("pre_assigned_to")}
    ).eq("id", entry["row_id"]).execute()


def _revert_state(client, entry: dict) -> None:
    client.table("prospects").update(
        {"state": entry.get("pre_state")}
    ).eq("id", entry["row_id"]).execute()


def _revert_phone_lock(client, entry: dict) -> None:
    client.table("prospects").update(
        {
            "company_phone": entry.get("pre_phone"),
            "user_overrides": entry.get("pre_user_overrides") or {},
        }
    ).eq("id", entry["row_id"]).execute()


def _revert_nonprofit_lock(client, entry: dict) -> None:
    client.table("prospects").update(
        {
            "is_nonprofit": entry.get("pre_is_nonprofit"),
            "nonprofit_source": entry.get("pre_nonprofit_source"),
            "ein": entry.get("pre_ein"),
            "user_overrides": entry.get("pre_user_overrides") or {},
        }
    ).eq("id", entry["row_id"]).execute()


def _delete_note(client, note_id: str | None) -> int:
    if not note_id:
        return 0
    res = client.table("prospect_notes").delete().eq("id", note_id).execute()
    return len(res.data or [])


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--keep-users",
        action="store_true",
        help="Skip synthetic-rep teardown (debug aid).",
    )
    args = ap.parse_args()

    client = _client()
    total = {
        "rep_deleted": 0,
        "edits_reverted": 0,
        "notes_deleted": 0,
    }

    snap: dict | None = None
    if SNAPSHOT_PATH.exists():
        snap = json.loads(SNAPSHOT_PATH.read_text())

    if snap:
        groups = snap.get("groups", {})
        pickup_entries = groups.get("pickup_state", [])
        if len(pickup_entries) >= 1:
            _revert_pickup_assign(client, pickup_entries[0])
            total["edits_reverted"] += 1
        if len(pickup_entries) >= 2:
            _revert_state(client, pickup_entries[1])
            total["edits_reverted"] += 1
        for entry in groups.get("phone_lock", []):
            _revert_phone_lock(client, entry)
            total["edits_reverted"] += 1
        for entry in groups.get("nonprofit_lock", []):
            _revert_nonprofit_lock(client, entry)
            total["edits_reverted"] += 1
        for entry in groups.get("notes", []):
            total["notes_deleted"] += _delete_note(client, entry.get("note_id"))

    if not args.keep_users:
        if _delete_user(client, STAGE10_REP):
            total["rep_deleted"] = 1
    else:
        print("Skipping user teardown (--keep-users).")

    if SNAPSHOT_PATH.exists():
        SNAPSHOT_PATH.unlink()

    print(
        f"Cleanup: rep_deleted={total['rep_deleted']} "
        f"edits_reverted={total['edits_reverted']} "
        f"notes_deleted={total['notes_deleted']}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
