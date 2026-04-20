#!/usr/bin/env python3
"""Stage 6 plant — seed test data before integrity runs.

Writes:
  cache/stage6_snapshot.json   — { started_at_iso, planted: { ... } }

Seeds:
  - 12 synthetic prospect_notes rows. 10 distributed across a spread of
    prospects so the home recent-activity feed has content; the remaining
    2 land on the Boston Ballet canonical seed so the detail page has a
    non-empty read-only notes list.
  - Creates a synthetic rep account `stage6-rep@example.com` (idempotent;
    re-used if it already exists).
  - 2 feedback rows:
      * one authored by the admin (`kingyareh@gmail.com`)
      * one authored by the synthetic rep
    Both span categories so the UI's history + status rendering can be
    exercised in the integrity scripts.

Idempotent: re-running replaces snapshot with fresh timestamps but does
not double-seed notes (keyed by cache marker) or feedback. To force a
re-seed, run `stage6_cleanup.py` first.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import sys
from pathlib import Path
from typing import Any

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

STAGE6_REP_EMAIL = "stage6-rep@example.com"
ADMIN_EMAIL = "kingyareh@gmail.com"
BOSTON_BALLET_NAME = "Boston Ballet"

NOTE_BODIES = [
    "Left a VM — following up Thursday.",
    "Prefers afternoon calls; owner handles sponsorship directly.",
    "Asked to revisit closer to fall concert season.",
    "Routed to marketing; will send brief one-pager.",
    "Interested in classical daypart; wants rate card.",
    "Looped in ops lead; decision turns on budget review.",
    "Confirmed local-only media buy, strong fit.",
    "Prior sponsor of WCRB — highly warm.",
    "Asked for audience composition data next touch.",
    "Might combine two locations into one underwriting run.",
    "Ballet-specific: coordinating with playbill copy for underwriting.",
    "Ballet-specific: decision maker is Marketing Director; intro mid-May.",
]


def _client():
    return create_client(SUPABASE_URL, SERVICE_KEY)


def _get_profile_by_email(client, email: str) -> dict[str, Any] | None:
    res = (
        client.table("profiles")
        .select("*")
        .ilike("email", email)
        .limit(1)
        .execute()
    )
    rows = res.data or []
    return rows[0] if rows else None


def _invite_or_get_rep(client, email: str) -> str:
    existing = _get_profile_by_email(client, email)
    if existing:
        return existing["id"]
    created = client.auth.admin.create_user(
        {
            "email": email,
            "email_confirm": True,
        }
    )
    if not created or not created.user:
        raise RuntimeError(f"Could not create synthetic user {email}")
    user_id = created.user.id
    # on_auth_user_created trigger populates public.profiles. Poll briefly
    # in case the trigger hasn't committed yet.
    for _ in range(10):
        row = _get_profile_by_email(client, email)
        if row:
            return row["id"]
        import time

        time.sleep(0.2)
    raise RuntimeError(f"profiles row missing after invite for {email}")


def _find_ballet(client) -> dict[str, Any] | None:
    res = (
        client.table("prospects")
        .select("id,company_name")
        .ilike("company_name", BOSTON_BALLET_NAME)
        .limit(1)
        .execute()
    )
    rows = res.data or []
    return rows[0] if rows else None


def _pick_note_targets(client) -> list[str]:
    # 10 distinct Tier A+B prospects, newest-added first, to spread activity feed.
    res = (
        client.table("prospects")
        .select("id,company_name,tier,created_at")
        .in_("tier", ["A", "B"])
        .order("created_at", desc=True)
        .limit(10)
        .execute()
    )
    rows = res.data or []
    return [r["id"] for r in rows]


def _seed_notes(client, admin_id: str, rep_id: str, ballet_id: str | None) -> list[str]:
    targets = _pick_note_targets(client)
    authors = [admin_id, rep_id]
    planted_ids: list[str] = []

    # 10 spread notes, staggered in time so "order by created_at desc" is
    # deterministic.
    now = dt.datetime.now(dt.UTC)
    for i, prospect_id in enumerate(targets):
        created_at = (now - dt.timedelta(minutes=10 + i)).isoformat()
        row = (
            client.table("prospect_notes")
            .insert(
                {
                    "prospect_id": prospect_id,
                    "author_id": authors[i % 2],
                    "body": f"[{CACHE_MARKER}] {NOTE_BODIES[i]}",
                    "created_at": created_at,
                }
            )
            .execute()
        )
        planted_ids.append(row.data[0]["id"])

    # 2 notes on Boston Ballet so the detail-page notes list is non-empty.
    if ballet_id:
        for i in (10, 11):
            row = (
                client.table("prospect_notes")
                .insert(
                    {
                        "prospect_id": ballet_id,
                        "author_id": authors[i % 2],
                        "body": f"[{CACHE_MARKER}] {NOTE_BODIES[i]}",
                    }
                )
                .execute()
            )
            planted_ids.append(row.data[0]["id"])
    return planted_ids


def _seed_feedback(client, admin_id: str, rep_id: str) -> list[str]:
    rows = [
        {
            "author_id": admin_id,
            "body": f"[{CACHE_MARKER}] Stage 6 admin test — data-issue flow exercised.",
            "category": "data_issue",
            "page_url": "/admin/feedback",
            "user_agent": "stage6-plant",
        },
        {
            "author_id": rep_id,
            "body": f"[{CACHE_MARKER}] Stage 6 rep test — idea category exercise.",
            "category": "idea",
            "page_url": "/",
            "user_agent": "stage6-plant",
        },
    ]
    planted: list[str] = []
    for r in rows:
        ins = client.table("feedback").insert(r).execute()
        planted.append(ins.data[0]["id"])
    return planted


def main() -> int:
    client = _client()

    if SNAPSHOT_PATH.exists():
        raise SystemExit(
            f"stage6 snapshot already exists at {SNAPSHOT_PATH}. "
            "Run stage6_cleanup.py before re-planting."
        )

    admin = _get_profile_by_email(client, ADMIN_EMAIL)
    if not admin:
        raise SystemExit(f"admin profile missing: {ADMIN_EMAIL}")
    admin_id = admin["id"]

    rep_id = _invite_or_get_rep(client, STAGE6_REP_EMAIL)

    ballet = _find_ballet(client)
    ballet_id = ballet["id"] if ballet else None

    note_ids = _seed_notes(client, admin_id, rep_id, ballet_id)
    feedback_ids = _seed_feedback(client, admin_id, rep_id)

    started_at_iso = dt.datetime.now(dt.UTC).isoformat()
    snapshot = {
        "started_at_iso": started_at_iso,
        "marker": CACHE_MARKER,
        "admin_id": admin_id,
        "rep_id": rep_id,
        "rep_email": STAGE6_REP_EMAIL,
        "ballet_id": ballet_id,
        "note_ids": note_ids,
        "feedback_ids": feedback_ids,
    }
    SNAPSHOT_PATH.parent.mkdir(parents=True, exist_ok=True)
    SNAPSHOT_PATH.write_text(json.dumps(snapshot, indent=2))
    print(
        f"Planted: {len(note_ids)} notes, {len(feedback_ids)} feedback rows, "
        f"rep_id={rep_id}, ballet_id={ballet_id}, started_at={started_at_iso}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
