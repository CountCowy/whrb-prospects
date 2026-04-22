#!/usr/bin/env python3
"""Stage 10c plant — fixtures for the run-controls + bulk-selection integrity run.

Seeds:
  - One synthetic rep (`stage10c-rep@example.com`, email_confirm=True) reused
    across run-cancel, flag-picker, bulk-paginate, bulk-basket, and feedback-
    scope specs. Admin is the existing `kingyareh@gmail.com`.
  - Four `pipeline_runs` rows for the cancel matrix (identified by UUID in
    the snapshot so cleanup never touches Stage-10 audit rows):
      * queued_id   — status='queued'
      * running_id  — status='running' + github_run_id=999_999_999 (synthetic)
      * success_id  — status='success'
      * failed_id   — status='failed'
  - Five synthetic Tier-C landscaping prospects tagged
    notes_internal='stage10c_fixture' for the T12 multi-query basket test.
  - One admin-authored feedback row + two rep-authored feedback rows tagged
    with body prefix 'stage10c fixture' for T17 (Home "Your feedback" scope).

Pre-conditions enforced:
  - Admin present.
  - event_log has 0 `level in ('error','fatal')` rows since Stage 10b exit
    (2026-04-22T00:45:00Z, matching the stage10b whitelist) outside the
    whitelist (plan §23.3 item 4 / §24.4).

Idempotent: refuses to run if cache/stage10c_snapshot.json exists; run
stage10c_cleanup.py first to start over.
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

SNAPSHOT_PATH = WHRB / "cache" / "stage10c_snapshot.json"
CACHE_MARKER = "stage10c_plant_v1"
FIXTURE_TAG = "stage10c_fixture"
FEEDBACK_PREFIX = "stage10c fixture:"
FIXTURE_PASSWORD = os.environ.get(
    "STAGE10C_FIXTURE_PASSWORD", "stage10c-fixture-password-7yux"
)

ADMIN_EMAIL = "kingyareh@gmail.com"
REP_EMAIL = "stage10c-rep@example.com"
SYNTHETIC_LANDSCAPERS = 5
LANDSCAPING_CATEGORY = "landscaping"

# Stage 10b exit whitelist — unchanged for 10c per plan §23.3 item 4.
STAGE10B_EXIT_ISO = "2026-04-22T00:45:00Z"
WHITELIST = {
    "admin_user_invite_failed",
    "source_failed",
    "scrape_http",
    "pipeline_run_failed",
    "email_skipped_no_provider",
}

# Stage 10c synthetic github_run_id — deliberately outside the range of any
# real workflow run so a cancel against it produces a 404 from GitHub (not a
# real workflow mutation).
SYNTHETIC_GITHUB_RUN_ID = 999_999_999


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
    return [r for r in rows if r.get("category") not in WHITELIST]


def _upsert_user_preferences(client, user_id: str) -> None:
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


def _seed_synthetic_landscapers(client) -> list[str]:
    boston_zips = ["02138", "02139", "02140", "02141", "02143"]
    rows_to_insert: list[dict] = []
    for i in range(SYNTHETIC_LANDSCAPERS):
        rid = str(uuid.uuid4())
        rows_to_insert.append(
            {
                "business_key": f"stage10c-fixture-{rid}",
                "company_name": f"Stage10c Fixture {i + 1:02d} Landscaping",
                "company_phone": f"+1617777{i:04d}"[:15],
                "company_email": f"stage10c-fixture-{i:02d}@example.com",
                "tier": "C",
                "category": LANDSCAPING_CATEGORY,
                "zip": boston_zips[i % len(boston_zips)],
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
    return [row["id"] for row in res.data or []]


def _seed_cancel_matrix(client, admin_id: str) -> dict[str, str]:
    """Seed 4 pipeline_runs rows for the cancel matrix.

    `triggered_by=None` on all four: the cancel API is admin-only regardless
    of who triggered the row, and leaving triggered_by null keeps these rows
    out of stage10_integrity.py's "admin-triggered" filters (so the stage10
    regression check doesn't pick up our fixtures as real admin runs).
    The `--stage10c-fixture` argv marker differentiates them from scheduled
    rows (which use '--scheduled')."""
    _ = admin_id
    now = dt.datetime.now(dt.UTC).isoformat()
    common = {"triggered_by": None, "args": "--stage10c-fixture", "created_at": now}
    rows = [
        # queued: cancel→failed transition target.
        {**common, "status": "queued"},
        # running: row with synthetic github_run_id so cancel has a target.
        {
            **common,
            "status": "running",
            "started_at": now,
            "github_run_id": SYNTHETIC_GITHUB_RUN_ID,
        },
        # success: already-finished, cancel should 400.
        {
            **common,
            "status": "success",
            "started_at": now,
            "finished_at": now,
            "rows_upserted": 0,
        },
        # failed: already-finished, cancel should 400. `error` prefix
        # deliberately does NOT start with 'cancelled by admin' so the T03
        # assertion can detect an unintended cancel.
        {
            **common,
            "status": "failed",
            "started_at": now,
            "finished_at": now,
            "error": "stage10c fixture seed: pre-failed row",
        },
    ]
    res = client.table("pipeline_runs").insert(rows).execute()
    data = res.data or []
    by_status: dict[str, str] = {}
    for row in data:
        by_status.setdefault(row["status"], row["id"])
    required = {"queued", "running", "success", "failed"}
    missing = required - set(by_status)
    if missing:
        raise RuntimeError(f"cancel matrix seed missing statuses: {missing}")
    return by_status


def _seed_feedback(client, admin_id: str, rep_id: str) -> dict[str, list[str]]:
    rows = [
        {
            "author_id": admin_id,
            "category": "other",
            "body": f"{FEEDBACK_PREFIX} admin's feedback row",
            "page_url": "/",
            "user_agent": "stage10c-plant",
            "status": "new",
        },
        {
            "author_id": rep_id,
            "category": "bug",
            "body": f"{FEEDBACK_PREFIX} rep row #1",
            "page_url": "/prospects",
            "user_agent": "stage10c-plant",
            "status": "new",
        },
        {
            "author_id": rep_id,
            "category": "idea",
            "body": f"{FEEDBACK_PREFIX} rep row #2",
            "page_url": "/my",
            "user_agent": "stage10c-plant",
            "status": "new",
        },
    ]
    res = client.table("feedback").insert(rows).execute()
    data = res.data or []
    admin_ids = [r["id"] for r in data if r.get("author_id") == admin_id]
    rep_ids = [r["id"] for r in data if r.get("author_id") == rep_id]
    return {"admin": admin_ids, "rep": rep_ids}


def main() -> int:
    client = _client()

    if SNAPSHOT_PATH.exists():
        raise SystemExit(
            f"stage10c snapshot already exists at {SNAPSHOT_PATH}. "
            "Run stage10c_cleanup.py before re-planting."
        )

    admin = _get_profile_by_email(client, ADMIN_EMAIL)
    if not admin:
        raise SystemExit(f"admin profile missing: {ADMIN_EMAIL}")

    unexpected = _sanity_errors_since(client, STAGE10B_EXIT_ISO)
    if unexpected:
        raise SystemExit(
            f"event_log has {len(unexpected)} unexpected error/fatal rows since "
            f"{STAGE10B_EXIT_ISO} (outside {sorted(WHITELIST)}). "
            f"Samples: {unexpected[:3]}. Investigate before planting."
        )

    rep_id = _create_rep(client, REP_EMAIL, FIXTURE_PASSWORD)
    _upsert_user_preferences(client, rep_id)

    fixture_ids = _seed_synthetic_landscapers(client)
    cancel_by_status = _seed_cancel_matrix(client, admin["id"])
    feedback_ids = _seed_feedback(client, admin["id"], rep_id)

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
        "feedback_prefix": FEEDBACK_PREFIX,
        "fixture_password": FIXTURE_PASSWORD,
        "admin_id": admin["id"],
        "admin_email": ADMIN_EMAIL,
        "rep_id": rep_id,
        "rep_email": REP_EMAIL,
        "basket_fixture_ids": fixture_ids,
        "real_landscaping_ids": [r["id"] for r in real_tier_c_landscapers],
        "cancel_targets": {
            "queued_id": cancel_by_status["queued"],
            "running_id": cancel_by_status["running"],
            "running_github_run_id": SYNTHETIC_GITHUB_RUN_ID,
            "success_id": cancel_by_status["success"],
            "failed_id": cancel_by_status["failed"],
        },
        "feedback_ids": feedback_ids,
        "stage10b_exit_iso": STAGE10B_EXIT_ISO,
        "whitelist": sorted(WHITELIST),
    }
    SNAPSHOT_PATH.parent.mkdir(parents=True, exist_ok=True)
    SNAPSHOT_PATH.write_text(json.dumps(snapshot, indent=2, default=str))

    print(
        f"Planted stage10c: rep={rep_id[:8]} "
        f"synthetic={len(fixture_ids)} "
        f"cancel_matrix={{q,r,s,f}}->{','.join(v[:8] for v in cancel_by_status.values())} "
        f"feedback_admin={len(feedback_ids['admin'])} feedback_rep={len(feedback_ids['rep'])} "
        f"started_at={started_at_iso}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
