#!/usr/bin/env python3
"""Stage 10c cleanup — remove Stage 10c fixtures.

Reads cache/stage10c_snapshot.json (tolerates a missing snapshot for
re-runs) and:

  1. Deletes the 4 seeded `pipeline_runs` rows by UUID from the snapshot.
     Stage 10c's seeded rows are test fixtures, not audit trail (plan
     §23.10 item 5). The 4 Stage-10 audit rows are NOT touched (identified
     separately; not in cancel_targets).
  2. Deletes the 5 synthetic landscaping prospects (`notes_internal =
     'stage10c_fixture'`) — cascades notifications + presence.
  3. Deletes the 3 seeded feedback rows by UUID.
  4. Hard-deletes the synthetic rep via auth.admin.delete_user (cascades
     profile + user_preferences).
  5. Removes cache/stage10c_snapshot.json.

Usage:
    .venv/bin/python scripts/stage10c_cleanup.py [--keep-users]
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
SNAPSHOT_PATH = CACHE_DIR / "stage10c_snapshot.json"

FIXTURE_TAG = "stage10c_fixture"
FEEDBACK_PREFIX = "stage10c fixture:"
REP_EMAIL = "stage10c-rep@example.com"


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


def _delete_cancel_matrix(client, ids: list[str]) -> int:
    """Delete pipeline_runs by explicit UUID list. Never touches historical
    Stage-10 audit rows — the snapshot only holds the 4 Stage 10c-seeded IDs."""
    if not ids:
        return 0
    res = client.table("pipeline_runs").delete().in_("id", ids).execute()
    return len(res.data or [])


def _delete_feedback(client, ids: list[str]) -> int:
    if not ids:
        # Defensive fallback — delete by body prefix if snapshot is missing.
        res = (
            client.table("feedback")
            .delete()
            .ilike("body", f"{FEEDBACK_PREFIX}%")
            .execute()
        )
        return len(res.data or [])
    res = client.table("feedback").delete().in_("id", ids).execute()
    return len(res.data or [])


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--keep-users", action="store_true")
    args = ap.parse_args()

    client = _client()
    total = {
        "fixtures_deleted": 0,
        "cancel_matrix_deleted": 0,
        "feedback_deleted": 0,
        "users_deleted": 0,
    }

    snap: dict = {}
    if SNAPSHOT_PATH.exists():
        snap = json.loads(SNAPSHOT_PATH.read_text())

    cancel_ids = []
    if snap.get("cancel_targets"):
        ct = snap["cancel_targets"]
        for k in ("queued_id", "running_id", "success_id", "failed_id"):
            v = ct.get(k)
            if isinstance(v, str):
                cancel_ids.append(v)
    total["cancel_matrix_deleted"] = _delete_cancel_matrix(client, cancel_ids)

    total["fixtures_deleted"] = _delete_fixtures(client)

    feedback_ids: list[str] = []
    fm = snap.get("feedback_ids") or {}
    feedback_ids.extend(fm.get("admin") or [])
    feedback_ids.extend(fm.get("rep") or [])
    total["feedback_deleted"] = _delete_feedback(client, feedback_ids)

    if not args.keep_users:
        if _delete_user(client, REP_EMAIL):
            total["users_deleted"] += 1
    else:
        print("Skipping user teardown (--keep-users).")

    if SNAPSHOT_PATH.exists():
        SNAPSHOT_PATH.unlink()

    print(
        f"Cleanup: fixtures_deleted={total['fixtures_deleted']} "
        f"cancel_matrix_deleted={total['cancel_matrix_deleted']} "
        f"feedback_deleted={total['feedback_deleted']} "
        f"users_deleted={total['users_deleted']}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
