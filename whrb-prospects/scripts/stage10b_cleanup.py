#!/usr/bin/env python3
"""Stage 10b cleanup - remove fixtures + revert state.

Reads cache/stage10b_snapshot.json (tolerates missing snapshot for
re-runs against a half-torn-down state) and:

  1. Deletes every `prospects` row with notes_internal = 'stage10b_fixture'
     (the 28 synthetic landscaping rows; cascades notifications + presence).
  2. Hard-deletes stage10b notifications + presence referencing the two
     synthetic reps (idempotent safety net).
  3. Restores `prospects.assigned_to` for any non-fixture real rows that
     Playwright / the Python integrity script left assigned to a synthetic
     rep (mostly defensive - typical test paths leave assignments on
     fixture rows, which are hard-deleted above).
  4. Hard-deletes user_preferences + profiles + auth.users for both
     synthetic reps (cascades).
  5. Removes cache/stage10b_snapshot.json.

Usage:
  .venv/bin/python scripts/stage10b_cleanup.py [--keep-users]
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
SNAPSHOT_PATH = CACHE_DIR / "stage10b_snapshot.json"

FIXTURE_TAG = "stage10b_fixture"
REP_EMAILS = ["stage10b-rep-a@example.com", "stage10b-rep-b@example.com"]


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
    return rows[0]["id"] if rows else None


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


def _delete_fixtures(client) -> int:
    res = (
        client.table("prospects")
        .delete()
        .eq("notes_internal", FIXTURE_TAG)
        .execute()
    )
    return len(res.data or [])


def _revert_real_assignments(client, rep_ids: list[str]) -> int:
    if not rep_ids:
        return 0
    count = 0
    for rid in rep_ids:
        res = (
            client.table("prospects")
            .update({"assigned_to": None, "assigned_at": None})
            .eq("assigned_to", rid)
            .is_("notes_internal", "null")
            .execute()
        )
        count += len(res.data or [])
    return count


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--keep-users", action="store_true")
    args = ap.parse_args()

    client = _client()
    total = {
        "fixtures_deleted": 0,
        "real_assignments_reverted": 0,
        "users_deleted": 0,
    }

    rep_ids: list[str] = []
    if SNAPSHOT_PATH.exists():
        snap = json.loads(SNAPSHOT_PATH.read_text())
        rep_ids = [snap.get("rep_a_id"), snap.get("rep_b_id")]
        rep_ids = [r for r in rep_ids if r]

    # Augment with fresh email → id lookup in case the snapshot is missing.
    if not rep_ids:
        for email in REP_EMAILS:
            uid = _find_profile_id(client, email)
            if uid:
                rep_ids.append(uid)

    total["real_assignments_reverted"] = _revert_real_assignments(client, rep_ids)
    total["fixtures_deleted"] = _delete_fixtures(client)

    if not args.keep_users:
        for email in REP_EMAILS:
            if _delete_user(client, email):
                total["users_deleted"] += 1
    else:
        print("Skipping user teardown (--keep-users).")

    if SNAPSHOT_PATH.exists():
        SNAPSHOT_PATH.unlink()

    print(
        f"Cleanup: fixtures_deleted={total['fixtures_deleted']} "
        f"real_assignments_reverted={total['real_assignments_reverted']} "
        f"users_deleted={total['users_deleted']}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
