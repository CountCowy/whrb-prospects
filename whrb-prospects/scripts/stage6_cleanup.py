#!/usr/bin/env python3
"""Stage 6 cleanup — tear down every plant artifact.

Deletes:
  - All prospect_notes + feedback rows whose bodies carry the
    `[stage6_plant_v1]` marker (idempotent; tolerates partial prior cleanup).
  - stage6-rep@example.com synthetic rep (auth.admin.delete_user cascades
    to the public.profiles row).
  - stage6a-smoke@example.com synthetic user from Stage 6a — owed by the
    Stage 6 cleanup per memory (Stage 6a lacked its own teardown).
  - cache/stage6_snapshot.json

Running Stage 6a again afterwards re-creates stage6a-smoke@example.com
idempotently from auth.setup.ts. Re-running Stage 6 cleanup after a
clean state is a no-op.
"""
from __future__ import annotations

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

SNAPSHOT_PATH = WHRB / "cache" / "stage6_snapshot.json"

CACHE_MARKER = "stage6_plant_v1"
EMAILS_TO_DELETE = (
    "stage6-rep@example.com",
    "stage6a-smoke@example.com",
)


def _client():
    return create_client(SUPABASE_URL, SERVICE_KEY)


def _delete_marked_rows(client, table: str) -> int:
    # Postgrest `.ilike()` on the body pattern matches both stage6 plant
    # variants and any stray row that somehow picked up the marker.
    res = (
        client.table(table)
        .delete()
        .ilike("body", f"%[{CACHE_MARKER}]%")
        .execute()
    )
    return len(res.data or [])


def _delete_e2e_feedback(client) -> int:
    # The Playwright T19 spec inserts feedback rows authored by the
    # stage6a-smoke synthetic user. Those rows are NOT tagged with the plant
    # marker (the test exercises the real write path, unadorned). After the
    # cascading delete of the synthetic user the rows' author_id becomes
    # NULL but the rows persist. Match by body prefix instead.
    res = (
        client.table("feedback")
        .delete()
        .ilike("body", "Stage 6 e2e feedback %")
        .execute()
    )
    return len(res.data or [])


def _delete_user_by_email(client, email: str) -> bool:
    users = client.auth.admin.list_users(per_page=200)
    # Some SDK versions return a `.users` list, others return a raw list.
    candidates = getattr(users, "users", None)
    if candidates is None and isinstance(users, list):
        candidates = users
    if candidates is None:
        return False
    match = next((u for u in candidates if (u.email or "").lower() == email.lower()), None)
    if not match:
        return False
    client.auth.admin.delete_user(match.id)
    return True


def main() -> int:
    client = _client()

    deleted_notes = _delete_marked_rows(client, "prospect_notes")
    deleted_feedback = _delete_marked_rows(client, "feedback")
    deleted_e2e_feedback = _delete_e2e_feedback(client)
    print(
        f"Deleted notes={deleted_notes}, feedback={deleted_feedback} "
        f"(+e2e orphans={deleted_e2e_feedback})"
    )

    for email in EMAILS_TO_DELETE:
        ok = _delete_user_by_email(client, email)
        print(f"deleteUser {email}: {'OK' if ok else 'NOT FOUND'}")

    if SNAPSHOT_PATH.exists():
        SNAPSHOT_PATH.unlink()
        print(f"Removed {SNAPSHOT_PATH}")
    else:
        print(f"No snapshot at {SNAPSHOT_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
