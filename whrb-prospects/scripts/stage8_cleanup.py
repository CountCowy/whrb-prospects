#!/usr/bin/env python3
"""Stage 8 cleanup — restore the 20-row change set + remove synthetic reps.

Reads cache/stage8_snapshot.json and reverses every planted edit:

  * pickup_state rows: restore pre_assigned_to + pre_state.
  * phone_lock rows: restore pre_phone + pre_user_overrides.
  * nonprofit_lock rows: restore pre_is_nonprofit / pre_nonprofit_source / pre_ein
    + pre_user_overrides.
  * email_lock rows: restore pre_email + pre_user_overrides.
  * notes: hard-delete every row whose body matches the plant marker.

Then deletes the synthetic Stage-7-retained reps
``stage7-rep-a@example.com`` and ``stage7-rep-b@example.com`` via
``auth.admin.delete_user`` (per plan §6.4 — Stage 8's cleanup tears them down).

Removes cache/stage8_snapshot.json, cache/stage8_change_log.jsonl, and
cache/stage8_postrun_*.exit marker files.

Idempotent: missing snapshot → no-op for the data side. Synthetic reps are
deleted by lookup; missing → skipped.

Usage:
  .venv/bin/python scripts/stage8_cleanup.py [--keep-reps]
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
SNAPSHOT_PATH = CACHE_DIR / "stage8_snapshot.json"
CHANGE_LOG_PATH = CACHE_DIR / "stage8_change_log.jsonl"
PLANT_MARKER = "stage8_plant_v1"

POSTRUN_EXIT_PATTERNS = ("stage8_postrun_*.exit",)

REP_EMAILS = ("stage7-rep-a@example.com", "stage7-rep-b@example.com")


def _client():
    return create_client(SUPABASE_URL, SERVICE_KEY)


def _restore_pickup(client, entries: list[dict]) -> int:
    n = 0
    for e in entries:
        client.table("prospects").update(
            {
                "assigned_to": e.get("pre_assigned_to"),
                "assigned_at": None if e.get("pre_assigned_to") is None else None,
                "state": e.get("pre_state"),
            }
        ).eq("id", e["row_id"]).execute()
        n += 1
    return n


def _restore_phone(client, entries: list[dict]) -> int:
    n = 0
    for e in entries:
        client.table("prospects").update(
            {
                "company_phone": e.get("pre_phone"),
                "user_overrides": e.get("pre_user_overrides") or {},
            }
        ).eq("id", e["row_id"]).execute()
        n += 1
    return n


def _restore_nonprofit(client, entries: list[dict]) -> int:
    n = 0
    for e in entries:
        client.table("prospects").update(
            {
                "is_nonprofit": e.get("pre_is_nonprofit"),
                "nonprofit_source": e.get("pre_nonprofit_source"),
                "ein": e.get("pre_ein"),
                "user_overrides": e.get("pre_user_overrides") or {},
            }
        ).eq("id", e["row_id"]).execute()
        n += 1
    return n


def _restore_email(client, entries: list[dict]) -> int:
    n = 0
    for e in entries:
        client.table("prospects").update(
            {
                "company_email": e.get("pre_email"),
                "user_overrides": e.get("pre_user_overrides") or {},
            }
        ).eq("id", e["row_id"]).execute()
        n += 1
    return n


def _delete_marked_notes(client) -> int:
    res = (
        client.table("prospect_notes")
        .delete()
        .ilike("body", f"%[{PLANT_MARKER}]%")
        .execute()
    )
    return len(res.data or [])


def _delete_synthetic_reps(client) -> int:
    n = 0
    for email in REP_EMAILS:
        res = (
            client.table("profiles")
            .select("id,email")
            .ilike("email", email)
            .limit(1)
            .execute()
        )
        rows = res.data or []
        if not rows:
            continue
        uid = rows[0]["id"]
        try:
            client.auth.admin.delete_user(uid)
            n += 1
        except Exception as exc:
            print(f"warn: could not delete {email} ({uid}): {exc}", file=sys.stderr)
    return n


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--keep-reps",
        action="store_true",
        help="Skip the synthetic-rep teardown (debug aid).",
    )
    args = ap.parse_args()

    client = _client()
    total = {"pickup": 0, "phone": 0, "nonprofit": 0, "email": 0, "notes": 0, "reps": 0}

    if SNAPSHOT_PATH.exists():
        snap = json.loads(SNAPSHOT_PATH.read_text())
        groups = snap.get("groups", {})
        total["pickup"] = _restore_pickup(client, groups.get("pickup_state", []))
        total["phone"] = _restore_phone(client, groups.get("phone_lock", []))
        total["nonprofit"] = _restore_nonprofit(client, groups.get("nonprofit_lock", []))
        total["email"] = _restore_email(client, groups.get("email_lock", []))
        total["notes"] = _delete_marked_notes(client)
    else:
        print(f"No snapshot at {SNAPSHOT_PATH}; only deleting marker-tagged notes.")
        total["notes"] = _delete_marked_notes(client)

    if not args.keep_reps:
        total["reps"] = _delete_synthetic_reps(client)
    else:
        print("Skipping rep teardown (--keep-reps).")

    # Remove cache artifacts.
    for path in [SNAPSHOT_PATH, CHANGE_LOG_PATH]:
        if path.exists():
            path.unlink()
    for pattern in POSTRUN_EXIT_PATTERNS:
        for p in CACHE_DIR.glob(pattern):
            p.unlink()

    print(
        f"Restored: pickup={total['pickup']} phone={total['phone']} "
        f"nonprofit={total['nonprofit']} email={total['email']} "
        f"notes_deleted={total['notes']} reps_deleted={total['reps']}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
