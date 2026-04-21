#!/usr/bin/env python3
"""Stage 10 plant — fixtures for the pipeline-dispatch integrity run.

Writes:
  cache/stage10_snapshot.json — {
    started_at_iso, marker,
    fixture_password, admin_id, admin_email,
    synthetic_rep_id, synthetic_rep_email,
    pre_pipeline_runs_count, pre_event_log_count,
    groups: {                                # shape compatible with postrun_check.py
      pickup_state:    [{row_id, business_key, pre_assigned_to, pre_state,
                         target_assigned_to, target_state}, ... ]   x2
      phone_lock:      [{row_id, business_key, pre_phone, target_phone,
                         pre_user_overrides}]                       x1
      notes:           [{row_id, business_key, body, author_email,
                         note_id}]                                  x1
      nonprofit_lock:  [{row_id, business_key, pre_is_nonprofit,
                         pre_nonprofit_source, pre_ein,
                         target_is_nonprofit, target_nonprofit_source,
                         pre_user_overrides}]                       x1
      email_lock:      []                                           x0
    }
  }

Seeds:
  - One synthetic rep (stage10-rep@example.com) via
    auth.admin.create_user(email_confirm=True, password=...) — same pattern
    Stage 9 used. Used only for T05 (non-admin 403 guard).
  - 5 edits spanning the postrun_check.py groups (round-10 §21.5 item 15):
      1 pickup (self-assign, state unchanged),
      1 state change (assign unchanged),
      1 phone_lock, 1 note, 1 nonprofit_lock.
  - Each edit is applied via service-role client (no browser, no UI).

Pre-conditions enforced before mutation:
  - Admin present (role='admin').
  - event_log has 0 rows with level in ('error','fatal') since Stage 9 exit
    OUTSIDE the Stage 9 stimulus whitelist (admin_user_invite_failed,
    source_failed). Round-10 §21.1 item 3 tolerance.

Idempotent: refuses to run if cache/stage10_snapshot.json already exists;
run stage10_cleanup.py first to start over.
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

SNAPSHOT_PATH = WHRB / "cache" / "stage10_snapshot.json"
CACHE_MARKER = "stage10_plant_v1"
FIXTURE_PASSWORD = os.environ.get(
    "STAGE10_FIXTURE_PASSWORD", "stage10-fixture-password-4rvh"
)

STAGE10_REP = "stage10-rep@example.com"
ADMIN_EMAIL = "kingyareh@gmail.com"

# Stage 9 exit reference — all stimulus categories already observed there.
STAGE9_EXIT_ISO = "2026-04-21T12:00:00Z"
STAGE9_WHITELIST = {
    "admin_user_invite_failed",
    "source_failed",
    # Stage 10 introduces `pipeline_run_failed` via T04; it only appears
    # after the forced-failure probe fires, but whitelist up-front so a
    # late re-plant (after T04) is idempotent.
    "pipeline_run_failed",
}

# Canonical seeds to exclude from edit targets.
CANONICAL_SEEDS = {
    "Boston Ballet",
    "Museum of Fine Arts",
    "Boston Symphony Orchestra",
    "Harvard Art Museums",
    "Isabella Stewart Gardner Museum",
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
    return [r for r in rows if r.get("category") not in STAGE9_WHITELIST]


def _pick_rows(client, n: int) -> list[dict]:
    """Pick non-canonical prospects with populated fields for editing."""
    res = (
        client.table("prospects")
        .select(
            "id,business_key,company_name,state,assigned_to,company_phone,"
            "company_email,is_nonprofit,nonprofit_source,ein,user_overrides"
        )
        .not_.in_("company_name", list(CANONICAL_SEEDS))
        .not_.is_("company_phone", "null")
        .not_.is_("company_name", "null")
        .order("id")
        .limit(200)
        .execute()
    )
    rows = res.data or []
    # Deterministic selection — sort by id for reproducibility.
    picked: list[dict] = []
    seen: set[str] = set()
    for r in rows:
        cname = r.get("company_name") or ""
        if not cname or cname in seen:
            continue
        if (r.get("user_overrides") or {}):
            # Skip rows already locked by prior stage fixtures.
            continue
        picked.append(r)
        seen.add(cname)
        if len(picked) >= n:
            break
    if len(picked) < n:
        raise RuntimeError(
            f"only found {len(picked)} eligible prospects for {n} edits; "
            "broaden filter"
        )
    return picked


def _apply_phone_lock(client, row_id: str, new_phone: str) -> None:
    cur = (
        client.table("prospects")
        .select("user_overrides")
        .eq("id", row_id)
        .single()
        .execute()
    )
    uo = (cur.data or {}).get("user_overrides") or {}
    uo = dict(uo)
    uo["company_phone"] = True
    client.table("prospects").update(
        {"company_phone": new_phone, "user_overrides": uo}
    ).eq("id", row_id).execute()


def _apply_state_change(client, row_id: str, new_state: str) -> None:
    client.table("prospects").update({"state": new_state}).eq("id", row_id).execute()


def _apply_self_assign(client, row_id: str, user_id: str) -> None:
    client.table("prospects").update(
        {
            "assigned_to": user_id,
            "assigned_at": dt.datetime.now(dt.UTC).isoformat(),
        }
    ).eq("id", row_id).execute()


def _apply_nonprofit_override(client, row_id: str) -> None:
    cur = (
        client.table("prospects")
        .select("user_overrides")
        .eq("id", row_id)
        .single()
        .execute()
    )
    uo = (cur.data or {}).get("user_overrides") or {}
    uo = dict(uo)
    uo["is_nonprofit"] = True
    uo["nonprofit_source"] = True
    client.table("prospects").update(
        {
            "is_nonprofit": True,
            "nonprofit_source": "manual",
            "user_overrides": uo,
        }
    ).eq("id", row_id).execute()


def _seed_note(client, row_id: str, author_id: str, body: str) -> str:
    res = (
        client.table("prospect_notes")
        .insert({"prospect_id": row_id, "author_id": author_id, "body": body})
        .execute()
    )
    if not res.data:
        raise RuntimeError(f"could not seed note on {row_id}")
    return res.data[0]["id"]


def main() -> int:
    client = _client()

    if SNAPSHOT_PATH.exists():
        raise SystemExit(
            f"stage10 snapshot already exists at {SNAPSHOT_PATH}. "
            "Run stage10_cleanup.py before re-planting."
        )

    admin = _get_profile_by_email(client, ADMIN_EMAIL)
    if not admin:
        raise SystemExit(f"admin profile missing: {ADMIN_EMAIL}")

    unexpected = _sanity_errors_since(client, STAGE9_EXIT_ISO)
    if unexpected:
        raise SystemExit(
            f"event_log has {len(unexpected)} unexpected error/fatal rows since "
            f"{STAGE9_EXIT_ISO} (outside {sorted(STAGE9_WHITELIST)}). "
            f"Samples: {unexpected[:3]}. Investigate before planting."
        )

    rep_id = _create_rep(client, STAGE10_REP, FIXTURE_PASSWORD)

    # Baseline counts for T06/T07/T11 delta assertions.
    pre_runs_res = (
        client.table("pipeline_runs").select("id", count="exact", head=True).execute()
    )
    pre_event_res = (
        client.table("event_log").select("id", count="exact", head=True).execute()
    )
    pre_runs_count = pre_runs_res.count or 0
    pre_events_count = pre_event_res.count or 0

    # Pick 5 rows for 5 edits. pickup + state need to be on DIFFERENT rows
    # (pickup_state covers both assign+state in the snapshot; we use 2 entries
    # so that one tests assign-only and the other tests state-only — each
    # entry's target mirrors the pre_* for the other axis).
    picks = _pick_rows(client, 5)
    pickup_row, state_row, phone_row, note_row, np_row = picks

    # 1. pickup (assign only)
    _apply_self_assign(client, pickup_row["id"], rep_id)

    # 2. state change
    _apply_state_change(client, state_row["id"], "initial_contact")

    # 3. phone_lock
    new_phone = "+16175550100"
    _apply_phone_lock(client, phone_row["id"], new_phone)

    # 4. note (author = synthetic rep)
    note_body = f"[{CACHE_MARKER}] stage10 plant note — postrun_check target"
    note_id = _seed_note(client, note_row["id"], rep_id, note_body)

    # 5. nonprofit override
    _apply_nonprofit_override(client, np_row["id"])

    started_at_iso = dt.datetime.now(dt.UTC).isoformat()
    snapshot = {
        "started_at_iso": started_at_iso,
        "marker": CACHE_MARKER,
        "fixture_password": FIXTURE_PASSWORD,
        "admin_id": admin["id"],
        "admin_email": ADMIN_EMAIL,
        "synthetic_rep_id": rep_id,
        "synthetic_rep_email": STAGE10_REP,
        "pre_pipeline_runs_count": pre_runs_count,
        "pre_event_log_count": pre_events_count,
        "stage9_exit_iso": STAGE9_EXIT_ISO,
        "stage9_whitelist": sorted(STAGE9_WHITELIST),
        "groups": {
            "pickup_state": [
                {
                    "row_id": pickup_row["id"],
                    "business_key": pickup_row["business_key"],
                    "pre_assigned_to": pickup_row.get("assigned_to"),
                    "pre_state": pickup_row.get("state"),
                    "target_assigned_to": rep_id,
                    "target_state": pickup_row.get("state"),
                },
                {
                    "row_id": state_row["id"],
                    "business_key": state_row["business_key"],
                    "pre_assigned_to": state_row.get("assigned_to"),
                    "pre_state": state_row.get("state"),
                    "target_assigned_to": state_row.get("assigned_to"),
                    "target_state": "initial_contact",
                },
            ],
            "phone_lock": [
                {
                    "row_id": phone_row["id"],
                    "business_key": phone_row["business_key"],
                    "pre_phone": phone_row.get("company_phone"),
                    "target_phone": new_phone,
                    "pre_user_overrides": phone_row.get("user_overrides") or {},
                }
            ],
            "notes": [
                {
                    "row_id": note_row["id"],
                    "business_key": note_row["business_key"],
                    "body": note_body,
                    "author_email": STAGE10_REP,
                    "note_id": note_id,
                }
            ],
            "nonprofit_lock": [
                {
                    "row_id": np_row["id"],
                    "business_key": np_row["business_key"],
                    "pre_is_nonprofit": np_row.get("is_nonprofit"),
                    "pre_nonprofit_source": np_row.get("nonprofit_source"),
                    "pre_ein": np_row.get("ein"),
                    "target_is_nonprofit": True,
                    "target_nonprofit_source": "manual",
                    "pre_user_overrides": np_row.get("user_overrides") or {},
                }
            ],
            "email_lock": [],
        },
    }
    SNAPSHOT_PATH.parent.mkdir(parents=True, exist_ok=True)
    SNAPSHOT_PATH.write_text(json.dumps(snapshot, indent=2, default=str))

    print(
        f"Planted stage10: rep={rep_id} "
        f"pickup={pickup_row['id'][:8]} state={state_row['id'][:8]} "
        f"phone={phone_row['id'][:8]} note={note_row['id'][:8]} "
        f"nonprofit={np_row['id'][:8]} "
        f"pre_runs={pre_runs_count} pre_events={pre_events_count} "
        f"started_at={started_at_iso}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
