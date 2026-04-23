#!/usr/bin/env python3
"""Stage 7 plant — seed fixtures before integrity runs.

Writes:
  cache/stage7_snapshot.json — { started_at_iso, rep_a_id, rep_b_id,
                                 note_subject_id, lock_subjects { field: {id, value} },
                                 note_ids, fixture_password }

Seeds:
  - Two synthetic rep accounts:
      * stage7-rep-a@example.com
      * stage7-rep-b@example.com
    Both with the same fixture password (FIXTURE_PASSWORD env/default) so the
    integrity scripts can obtain user-scoped JWTs for audit-trigger work.
  - Snapshots the full 15-field vector for each lock-matrix subject. Subjects
    are picked by a "first non-canonical pipeline row whose this-field is
    populated" heuristic (canonical seeds: Boston Ballet, MFA are skipped).
  - Seeds 2 `prospect_notes` rows authored by Rep A on one lock subject — the
    note-subject — to exercise the soft-delete / edit / admin-ghost flow.

Pre-conditions verified before mutation:
  - Admin present (role='admin').
  - event_log has 0 *unexpected* rows with level in ('error','fatal') since a
    documented reference timestamp. Known expected-stimulus categories
    (EXPECTED_STIMULUS_CATEGORIES) are filtered out — these are produced by
    later-stage test harnesses (dev-SMTP rate limit, pipeline scrape retries)
    and are not Stage 7 correctness signals.

Idempotent: re-running with an existing snapshot refuses; run
stage7_cleanup.py first to start over.
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

SNAPSHOT_PATH = WHRB / "cache" / "stage7_snapshot.json"
CACHE_MARKER = "stage7_plant_v1"
FIXTURE_PASSWORD = os.environ.get("STAGE7_FIXTURE_PASSWORD", "stage7-fixture-password-6rgp")

STAGE7_REP_A = "stage7-rep-a@example.com"
STAGE7_REP_B = "stage7-rep-b@example.com"
ADMIN_EMAIL = "kingyareh@gmail.com"

CANONICAL_SEEDS = {"Boston Ballet", "Museum of Fine Arts", "Massachusetts Bay Transportation Authority"}

# Mirrors stage9_integrity.T13_WHITELISTED_CATEGORIES (plus Stage 10's
# `pipeline_run_failed` from the round-10 §21.4 item 13 clarification,
# plus Stage 10c's `admin_cancel_run_failed` from the post-merge T02
# PAT-scope sign-off — see ROLLOUT.md "Post-merge T02 sign-off" section).
# These categories are expected stimuli of later-stage test harnesses and
# must not abort a Stage 7 plant.
# - admin_user_invite_failed: Stage 9 invite retries hitting dev-SMTP rate limits
# - source_failed / scrape_http: pipeline scrape retries on transient 4xx/5xx
# - pipeline_run_failed: Stage 10 T04 forced-failure probe
# - admin_cancel_run_failed: Stage 10c post-merge T02 PAT-scope incident
#   (two error events documented in the Stage 10c sign-off; the PAT was
#   subsequently fixed so no new events are generated).
EXPECTED_STIMULUS_CATEGORIES: tuple[str, ...] = (
    "admin_user_invite_failed",
    "source_failed",
    "scrape_http",
    "pipeline_run_failed",
    "admin_cancel_run_failed",
)

# The 15 lockable field names as defined in plan §16.3 item 9.
LOCKABLE_FIELDS: tuple[str, ...] = (
    "tier",
    "company_name",
    "company_phone",
    "company_email",
    "contact_name",
    "contact_email",
    "contact_phone",
    "website",
    "is_nonprofit",
    "nonprofit_source",
    "ein",
    "priority_score",
    "address",
    "zip",
    "category",
)

# Full snapshot column set (the lockable fields plus user_overrides so
# cleanup restores both state + locks).
SNAPSHOT_FIELDS: tuple[str, ...] = (*LOCKABLE_FIELDS, "user_overrides")


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
        # Ensure the password is set so integrity can sign in. `update_user_by_id`
        # is idempotent.
        try:
            client.auth.admin.update_user_by_id(existing["id"], {"password": password})
        except Exception as exc:
            print(f"warn: could not reset password for {email}: {exc}", file=sys.stderr)
        return existing["id"]
    created = client.auth.admin.create_user(
        {
            "email": email,
            "email_confirm": True,
            "password": password,
        }
    )
    if not created or not created.user:
        raise RuntimeError(f"Could not create synthetic user {email}")
    # Poll for the on_auth_user_created trigger to land the profile row.
    for _ in range(20):
        row = _get_profile_by_email(client, email)
        if row:
            return row["id"]
        import time

        time.sleep(0.15)
    raise RuntimeError(f"profiles row missing after invite for {email}")


def _pick_subject_for(client, field: str, exclude_ids: set[str]) -> dict[str, Any] | None:
    """Find the first non-canonical pipeline row with this field populated.

    We special-case `is_nonprofit` (boolean — we want a row with is_nonprofit=true
    so an "edit" can plausibly flip it; nonprofit_source / ein require a non-null
    value which is only present on nonprofit rows).
    """
    q = (
        client.table("prospects")
        .select(
            "id,company_name,tier,company_phone,company_email,contact_name,contact_email,"
            "contact_phone,website,is_nonprofit,nonprofit_source,ein,priority_score,"
            "address,zip,category,user_overrides"
        )
        .eq("created_source", "pipeline")
        .limit(200)
    )
    if field in ("nonprofit_source", "ein", "is_nonprofit"):
        q = q.eq("is_nonprofit", True).not_.is_(field, "null")
    elif field == "priority_score":
        q = q.not_.is_("priority_score", "null").gt("priority_score", 0)
    else:
        q = q.not_.is_(field, "null")
    rows = q.execute().data or []
    for row in rows:
        if row["id"] in exclude_ids:
            continue
        if row.get("company_name") in CANONICAL_SEEDS:
            continue
        if row.get(field) in (None, "", False):
            # is_nonprofit needs exactly True to flip → False; skip otherwise.
            continue
        return row
    return None


def _seed_notes(client, author_id: str, prospect_id: str) -> list[str]:
    bodies = [
        f"[{CACHE_MARKER}] Note 1 — soft-delete target for Rep A.",
        f"[{CACHE_MARKER}] Note 2 — edit target for Rep A.",
    ]
    planted: list[str] = []
    for body in bodies:
        ins = (
            client.table("prospect_notes")
            .insert(
                {
                    "prospect_id": prospect_id,
                    "author_id": author_id,
                    "body": body,
                }
            )
            .execute()
        )
        planted.append(ins.data[0]["id"])
    return planted


def _sanity_errors_since(client, since_iso: str) -> tuple[int, list[str]]:
    """Count error/fatal event_log rows since `since_iso`, excluding expected
    stimulus categories. Returns (count, up-to-3-sample-strings) so the caller
    can surface useful diagnostics when the gate trips.
    """
    res = (
        client.table("event_log")
        .select("category,created_at")
        .in_("level", ["error", "fatal"])
        .gte("created_at", since_iso)
        .order("created_at", desc=True)
        .limit(200)
        .execute()
    )
    rows = res.data or []
    unexpected = [
        r for r in rows
        if (r.get("category") or "") not in EXPECTED_STIMULUS_CATEGORIES
    ]
    samples = [f"{r['created_at']} {r.get('category')}" for r in unexpected[:3]]
    return len(unexpected), samples


def main() -> int:
    client = _client()

    if SNAPSHOT_PATH.exists():
        raise SystemExit(
            f"stage7 snapshot already exists at {SNAPSHOT_PATH}. "
            "Run stage7_cleanup.py before re-planting."
        )

    admin = _get_profile_by_email(client, ADMIN_EMAIL)
    if not admin:
        raise SystemExit(f"admin profile missing: {ADMIN_EMAIL}")

    stage6_exit_iso = "2026-04-20T04:45:00Z"
    err_count, err_samples = _sanity_errors_since(client, stage6_exit_iso)
    if err_count != 0:
        raise SystemExit(
            f"event_log has {err_count} unexpected error/fatal rows since "
            f"{stage6_exit_iso} "
            f"(whitelist={list(EXPECTED_STIMULUS_CATEGORIES)}). "
            f"Samples: {err_samples}. Investigate before planting."
        )

    rep_a_id = _create_rep(client, STAGE7_REP_A, FIXTURE_PASSWORD)
    rep_b_id = _create_rep(client, STAGE7_REP_B, FIXTURE_PASSWORD)

    # Pick a distinct subject per field (subjects may repeat if supply is
    # thin, but we try to avoid it to make failures easier to diagnose).
    used: set[str] = set()
    lock_subjects: dict[str, dict[str, Any]] = {}
    for field in LOCKABLE_FIELDS:
        subject = _pick_subject_for(client, field, used)
        if not subject:
            # Fall back: allow reuse.
            subject = _pick_subject_for(client, field, set())
        if not subject:
            raise SystemExit(f"could not find any subject row for field {field!r}")
        lock_subjects[field] = {
            "id": subject["id"],
            "snapshot": {f: subject.get(f) for f in SNAPSHOT_FIELDS},
        }
        used.add(subject["id"])

    # The note-subject prospect: use whatever the company_name lock-matrix
    # picked. (arbitrary but stable)
    note_subject_id = lock_subjects["company_name"]["id"]
    note_ids = _seed_notes(client, rep_a_id, note_subject_id)

    started_at_iso = dt.datetime.now(dt.UTC).isoformat()
    snapshot = {
        "started_at_iso": started_at_iso,
        "marker": CACHE_MARKER,
        "fixture_password": FIXTURE_PASSWORD,
        "admin_id": admin["id"],
        "rep_a_id": rep_a_id,
        "rep_a_email": STAGE7_REP_A,
        "rep_b_id": rep_b_id,
        "rep_b_email": STAGE7_REP_B,
        "lock_subjects": lock_subjects,
        "note_subject_id": note_subject_id,
        "note_ids": note_ids,
        "manual_add_tag": f"Stage 7 Manual Test {uuid.uuid4().hex[:8]}",
    }
    SNAPSHOT_PATH.parent.mkdir(parents=True, exist_ok=True)
    SNAPSHOT_PATH.write_text(json.dumps(snapshot, indent=2, default=str))
    print(
        f"Planted: rep_a={rep_a_id} rep_b={rep_b_id} "
        f"lock_subjects={len(lock_subjects)} notes={len(note_ids)} "
        f"started_at={started_at_iso}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
