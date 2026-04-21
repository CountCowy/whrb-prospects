#!/usr/bin/env python3
"""Stage 9 cleanup — restore source_config + tear down synthetic/invite users.

Reads cache/stage9_snapshot.json and:

  1. Clears `deactivated_at` on the synthetic rep before delete so a cleanup
     run against a half-torn-down state still terminates.
  2. Hard-deletes the synthetic rep (stage9-rep@example.com) via
     auth.admin.delete_user — covers role-reset + Remove test paths
     idempotently.
  3. Hard-deletes the T05 invite target (Crimsoncowy@gmail.com) if it is
     still in auth.users / profiles.
  4. Hard-deletes the seeded feedback row (id from snapshot).
  5. Restores all 9 source_config rows to their pre-plant
     {enabled, updated_by} via the snapshot.
  6. Removes cache/stage9_snapshot.json.

Idempotent: missing snapshot → only performs (2) + (3) by email lookup.

Usage:
  .venv/bin/python scripts/stage9_cleanup.py [--keep-users]
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
SNAPSHOT_PATH = CACHE_DIR / "stage9_snapshot.json"

STAGE9_REP = "stage9-rep@example.com"
INVITE_TARGET = "Crimsoncowy@gmail.com"


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


def _clear_deactivated(client, uid: str) -> None:
    client.table("profiles").update({"deactivated_at": None}).eq("id", uid).execute()


def _delete_user(client, email: str) -> bool:
    uid = _find_profile_id(client, email)
    if not uid:
        return False
    _clear_deactivated(client, uid)
    try:
        client.auth.admin.delete_user(uid)
        return True
    except Exception as exc:
        print(f"warn: could not delete {email} ({uid}): {exc}", file=sys.stderr)
        return False


def _restore_source_config(client, rows: list[dict]) -> int:
    n = 0
    for row in rows:
        client.table("source_config").update(
            {
                "enabled": row.get("enabled", True),
                "updated_by": row.get("updated_by"),
            }
        ).eq("source_key", row["source_key"]).execute()
        n += 1
    return n


def _delete_feedback(client, feedback_id: str | None) -> int:
    if not feedback_id:
        return 0
    res = client.table("feedback").delete().eq("id", feedback_id).execute()
    return len(res.data or [])


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--keep-users",
        action="store_true",
        help="Skip synthetic-rep + invite teardown (debug aid).",
    )
    args = ap.parse_args()

    client = _client()
    total = {
        "rep_deleted": 0,
        "invite_deleted": 0,
        "feedback_deleted": 0,
        "source_rows_restored": 0,
    }

    snap: dict | None = None
    if SNAPSHOT_PATH.exists():
        snap = json.loads(SNAPSHOT_PATH.read_text())

    if snap:
        total["source_rows_restored"] = _restore_source_config(
            client, snap.get("source_config_pre", [])
        )
        total["feedback_deleted"] = _delete_feedback(
            client, snap.get("seeded_feedback_id")
        )

    if not args.keep_users:
        if _delete_user(client, STAGE9_REP):
            total["rep_deleted"] = 1
        if _delete_user(client, INVITE_TARGET):
            total["invite_deleted"] = 1
    else:
        print("Skipping user teardown (--keep-users).")

    if SNAPSHOT_PATH.exists():
        SNAPSHOT_PATH.unlink()

    print(
        f"Cleanup: rep_deleted={total['rep_deleted']} "
        f"invite_deleted={total['invite_deleted']} "
        f"feedback_deleted={total['feedback_deleted']} "
        f"source_rows_restored={total['source_rows_restored']}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
