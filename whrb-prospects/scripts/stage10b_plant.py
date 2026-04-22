#!/usr/bin/env python3
"""Stage 10b plant - fixtures for the polish-pass integrity run.

Seeds:
  - Two synthetic reps (stage10b-rep-a@example.com, stage10b-rep-b@example.com)
    with email_confirm=True via auth.admin.create_user. Used by Playwright
    for presence (2 browser contexts), notification fan-out (A → B assign),
    note mentions, and mobile smoke tests.
  - Baseline user_preferences rows for both reps (all defaults).
  - ~28 synthetic Tier-C landscaping prospects (round-11 §22.4 item 9):
    company_name prefix "Stage10b Fixture", business_key prefix
    "stage10b-fixture-", notes_internal = 'stage10b_fixture', category = 'landscaping'.
    Combined with the 2 existing real Tier-C landscaping rows on dev, the
    bulk-assign sample (T10) sees ~30 rows.
  - Picks one prospect as the **presence subject** for T01-T04 (Boston
    Ballet canonical seed, guaranteed present since Stage 4).
  - Picks one prospect as the **notes/mention subject** for T06–T09
    (first non-canonical fixture row).

Writes cache/stage10b_snapshot.json with all IDs for the integrity /
Playwright scripts to read.

Pre-conditions enforced:
  - Admin present (role='admin', kingyareh@gmail.com).
  - event_log has 0 level in ('error','fatal') rows since Stage 10 exit
    (2026-04-22T00:45Z) outside the STAGE10B_WHITELIST (same as Stage 10
    + `email_skipped_no_provider` which Stage 10b introduces).

Idempotent: refuses to run if cache/stage10b_snapshot.json exists; run
stage10b_cleanup.py first to start over.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import sys
import uuid
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

SNAPSHOT_PATH = WHRB / "cache" / "stage10b_snapshot.json"
CACHE_MARKER = "stage10b_plant_v1"
FIXTURE_TAG = "stage10b_fixture"
FIXTURE_PASSWORD = os.environ.get(
    "STAGE10B_FIXTURE_PASSWORD", "stage10b-fixture-password-9mux"
)

REP_A = "stage10b-rep-a@example.com"
REP_B = "stage10b-rep-b@example.com"
ADMIN_EMAIL = "kingyareh@gmail.com"

SYNTHETIC_ROWS = 28
LANDSCAPING_CATEGORY = "landscaping"
PRESENCE_SUBJECT_NAME = "Boston Ballet"

STAGE10_EXIT_ISO = "2026-04-22T00:45:00Z"
STAGE10B_WHITELIST = {
    "admin_user_invite_failed",
    "source_failed",
    "scrape_http",
    "pipeline_run_failed",
    "email_skipped_no_provider",
}


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


def _create_rep(client, email: str, password: str) -> str:
    existing = _get_profile_by_email(client, email)
    if existing:
        try:
            client.auth.admin.update_user_by_id(existing["id"], {"password": password})
        except Exception as exc:
            print(f"warn: could not reset password for {email}: {exc}", file=sys.stderr)
        return existing["id"]
    created = client.auth.admin.create_user(
        {"email": email, "email_confirm": True, "password": password}
    )
    if not created or not created.user:
        raise RuntimeError(f"Could not create synthetic user {email}")
    import time

    for _ in range(20):
        row = _get_profile_by_email(client, email)
        if row:
            return row["id"]
        time.sleep(0.15)
    raise RuntimeError(f"profiles row missing after invite for {email}")


def _sanity_errors_since(client, since_iso: str) -> list[dict]:
    res = (
        client.table("event_log")
        .select("id,level,category,message,created_at")
        .in_("level", ["error", "fatal"])
        .gte("created_at", since_iso)
        .execute()
    )
    rows = res.data or []
    return [r for r in rows if r.get("category") not in STAGE10B_WHITELIST]


def _upsert_user_preferences(client, user_id: str) -> None:
    # Defaults from 000_init.sql lines 152-158.
    client.table("user_preferences").upsert(
        {
            "user_id": user_id,
            "notify_assignment_toast": True,
            "notify_assignment_email": True,
            "notify_mention_toast": True,
            "notify_mention_email": False,
            "notify_run_complete_email": False,
            "notify_feedback_status_email": True,
        },
        on_conflict="user_id",
    ).execute()


def _seed_synthetic_landscapers(client) -> list[dict]:
    """Create SYNTHETIC_ROWS Tier-C landscaping prospects marked with
    notes_internal=FIXTURE_TAG for easy cleanup."""
    boston_zips = ["02138", "02139", "02140", "02141", "02143", "02144", "02145",
                   "02446", "02445", "02215", "02116", "02118", "02130"]
    rows_to_insert: list[dict] = []
    for i in range(SYNTHETIC_ROWS):
        rid = str(uuid.uuid4())
        zip_code = boston_zips[i % len(boston_zips)]
        rows_to_insert.append(
            {
                "business_key": f"stage10b-fixture-{rid}",
                "company_name": f"Stage10b Fixture {i + 1:02d} Landscaping",
                "company_phone": f"+1617555{i:04d}"[:15],
                "company_email": f"stage10b-fixture-{i:02d}@example.com",
                "tier": "C",
                "category": LANDSCAPING_CATEGORY,
                "zip": zip_code,
                "state": "researching",
                "source": "manual",
                "priority_score": 5,
                "is_nonprofit": False,
                "created_source": "manual",
                "notes_internal": FIXTURE_TAG,
                "pipeline_last_seen_at": dt.datetime.now(dt.UTC).isoformat(),
            }
        )
    res = client.table("prospects").insert(rows_to_insert).execute()
    return res.data or []


def _find_presence_subject(client) -> dict[str, Any]:
    res = (
        client.table("prospects")
        .select("id,company_name")
        .ilike("company_name", PRESENCE_SUBJECT_NAME)
        .limit(1)
        .execute()
    )
    rows = res.data or []
    if not rows:
        # Fallback: any Tier-A row.
        res = (
            client.table("prospects")
            .select("id,company_name")
            .eq("tier", "A")
            .limit(1)
            .execute()
        )
        rows = res.data or []
    if not rows:
        raise RuntimeError("no presence subject available")
    return rows[0]


def main() -> int:
    client = _client()

    if SNAPSHOT_PATH.exists():
        raise SystemExit(
            f"stage10b snapshot already exists at {SNAPSHOT_PATH}. "
            "Run stage10b_cleanup.py before re-planting."
        )

    admin = _get_profile_by_email(client, ADMIN_EMAIL)
    if not admin:
        raise SystemExit(f"admin profile missing: {ADMIN_EMAIL}")

    unexpected = _sanity_errors_since(client, STAGE10_EXIT_ISO)
    if unexpected:
        raise SystemExit(
            f"event_log has {len(unexpected)} unexpected error/fatal rows since "
            f"{STAGE10_EXIT_ISO} (outside {sorted(STAGE10B_WHITELIST)}). "
            f"Samples: {unexpected[:3]}. Investigate before planting."
        )

    rep_a_id = _create_rep(client, REP_A, FIXTURE_PASSWORD)
    rep_b_id = _create_rep(client, REP_B, FIXTURE_PASSWORD)
    _upsert_user_preferences(client, rep_a_id)
    _upsert_user_preferences(client, rep_b_id)

    pre_notif_res = (
        client.table("notifications").select("id", count="exact", head=True).execute()
    )
    pre_notif_count = pre_notif_res.count or 0

    inserted = _seed_synthetic_landscapers(client)
    fixture_ids = [row["id"] for row in inserted]

    presence_subject = _find_presence_subject(client)
    notes_subject_id = fixture_ids[0]

    real_tier_c_landscapers = (
        client.table("prospects")
        .select("id,company_name")
        .eq("tier", "C")
        .ilike("category", "landscap%")
        .is_("notes_internal", "null")
        .execute()
        .data
        or []
    )

    started_at_iso = dt.datetime.now(dt.UTC).isoformat()
    snapshot = {
        "started_at_iso": started_at_iso,
        "marker": CACHE_MARKER,
        "fixture_tag": FIXTURE_TAG,
        "fixture_password": FIXTURE_PASSWORD,
        "admin_id": admin["id"],
        "admin_email": ADMIN_EMAIL,
        "rep_a_id": rep_a_id,
        "rep_a_email": REP_A,
        "rep_b_id": rep_b_id,
        "rep_b_email": REP_B,
        "fixture_prospect_ids": fixture_ids,
        "presence_subject_id": presence_subject["id"],
        "presence_subject_name": presence_subject["company_name"],
        "notes_subject_id": notes_subject_id,
        "pre_notification_count": pre_notif_count,
        "stage10_exit_iso": STAGE10_EXIT_ISO,
        "whitelist": sorted(STAGE10B_WHITELIST),
        "real_landscaping_ids": [r["id"] for r in real_tier_c_landscapers],
    }
    SNAPSHOT_PATH.parent.mkdir(parents=True, exist_ok=True)
    SNAPSHOT_PATH.write_text(json.dumps(snapshot, indent=2, default=str))

    print(
        f"Planted stage10b: rep_a={rep_a_id[:8]} rep_b={rep_b_id[:8]} "
        f"synthetic={len(fixture_ids)} real_landscapers={len(real_tier_c_landscapers)} "
        f"presence_subject={presence_subject['id'][:8]} "
        f"pre_notifications={pre_notif_count} "
        f"started_at={started_at_iso}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
