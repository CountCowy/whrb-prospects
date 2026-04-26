#!/usr/bin/env python3
"""Stage T3 plant — fixtures for the rep tag UI + integrity matrix.

Seeds:
  - One fixture prospect with 7 tags spanning 4 axes (used by the
    "compact 4 + overflow" + "full grouped by axis" Browser tests T01,
    T02, T03, T04, T07).
  - One locked compliance:political tag on the same prospect (T03 lock
    icon + clear-disabled state, T20a soft-clear path).
  - Two synthetic reps + one synthetic admin (RLS tests T17, T18, T19;
    rep-add notification flow T10, T25).
  - Two pending_admin_review vocab fixtures owned by rep_a (T10–T13
    moderation flow).

Snapshot at ``cache/t3_snapshot.json`` captures every UUID needed by
``t3_cleanup.py`` and ``t3_integrity.py``.

Idempotent: refuses to re-run if the snapshot already exists.
"""
from __future__ import annotations

import datetime as dt
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

from db.supabase_sync import business_key as compute_business_key

SUPABASE_URL = os.environ["SUPABASE_URL"]
SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

SNAPSHOT_PATH = WHRB / "cache" / "t3_snapshot.json"

ADMIN_EMAIL = "kingyareh@gmail.com"  # existing admin (Stage 1 invite)
REP_A_EMAIL = "t3-rep-a@example.com"
REP_B_EMAIL = "t3-rep-b@example.com"
REP_PASSWORD = os.environ.get("T3_FIXTURE_PASSWORD", "t3-fixture-password-x9k4")

# Fixture prospect — 7 tags spread across sector / genre / affiliation /
# compliance, plus an "other" tag, gives the compact-mode 4-+-3 overflow
# scenario the table renders.
FIXTURE_PROSPECT = {
    "company_name": "T3 Fixture Seven Tag Co",
    "tier": "B",
    "state": "researching",
    "created_source": "manual",
    "source": "osm",
    "category": "amenity=arts_centre",
    "zip": "02138",
}

# (axis, value) pairs to attach to the fixture prospect.
FIXTURE_TAGS_FROM_VOCAB = [
    ("sector", "arts"),
    ("sector", "nonprofit"),
    ("operating_model", "ensemble"),
    ("genre", "classical"),
    ("affiliation", "harvard_affiliated"),
    ("history", "wcrb_sponsor"),
    ("compliance", "political"),  # locked + later soft-cleared in tests
]

# Pending-vocab fixtures created by rep_a so admins see two
# `tag_vocab_pending` notifications in their inbox at integrity time.
PENDING_VOCAB_FIXTURES = [
    {"axis": "other", "value": "t3_pending_alpha"},
    {"axis": "other", "value": "t3_pending_beta"},
]


def _client():
    return create_client(SUPABASE_URL, SERVICE_KEY)


def _ensure_user(sb, email: str, password: str, role: str | None = None) -> str:
    """Idempotent user creation. Returns auth.uid()."""
    page = sb.auth.admin.list_users()
    users = page if isinstance(page, list) else getattr(page, "users", []) or []
    for u in users:
        u_email = getattr(u, "email", None) or (u.get("email") if isinstance(u, dict) else None)
        if u_email == email:
            uid = getattr(u, "id", None) or (u.get("id") if isinstance(u, dict) else None)
            return uid
    res = sb.auth.admin.create_user(
        {
            "email": email,
            "password": password,
            "email_confirm": True,
        }
    )
    user = res.user if hasattr(res, "user") else res.get("user")
    uid = user.id if hasattr(user, "id") else user.get("id")
    if role:
        sb.table("profiles").update({"role": role}).eq("id", uid).execute()
    return uid


def _resolve_vocab_id(sb, axis: str, value: str) -> str:
    res = (
        sb.table("tag_vocabulary")
        .select("id")
        .eq("axis", axis)
        .eq("value", value)
        .maybe_single()
        .execute()
    )
    if res.data is None:
        raise RuntimeError(f"vocab not seeded: ({axis}, {value})")
    return res.data["id"]


def _attach_tag(sb, prospect_id: str, vocab_id: str, *, created_by: str | None) -> str:
    payload = {"prospect_id": prospect_id, "tag_id": vocab_id}
    if created_by:
        payload["created_by"] = created_by
    res = sb.table("prospect_tags").insert(payload).execute()
    return res.data[0]["id"]


def main() -> int:
    if SNAPSHOT_PATH.exists():
        print(f"REFUSE: {SNAPSHOT_PATH} already exists. Run t3_cleanup.py first.")
        return 1

    sb = _client()
    started = dt.datetime.now(tz=dt.UTC).isoformat()

    rep_a_id = _ensure_user(sb, REP_A_EMAIL, REP_PASSWORD, role="rep")
    rep_b_id = _ensure_user(sb, REP_B_EMAIL, REP_PASSWORD, role="rep")
    # Admin is pre-seeded; just resolve the id.
    admin_lookup = (
        sb.table("profiles")
        .select("id")
        .eq("email", ADMIN_EMAIL)
        .maybe_single()
        .execute()
    )
    if admin_lookup.data is None:
        raise RuntimeError(f"admin not found: {ADMIN_EMAIL}")
    admin_id = admin_lookup.data["id"]

    # Create the fixture prospect.
    payload = dict(FIXTURE_PROSPECT)
    payload["business_key"] = compute_business_key(payload)
    prospect_res = (
        sb.table("prospects")
        .insert(payload)
        .execute()
    )
    prospect_id = prospect_res.data[0]["id"]

    # Resolve vocab ids and attach tags. Six are pipeline-style
    # (created_by=null); compliance:political is locked by rep_a so
    # T03 + T20a + T18 can exercise the lock-aware DELETE path.
    tag_row_ids: dict[str, str] = {}
    for axis, value in FIXTURE_TAGS_FROM_VOCAB:
        vocab_id = _resolve_vocab_id(sb, axis, value)
        if axis == "compliance":
            row_id = _attach_tag(sb, prospect_id, vocab_id, created_by=rep_a_id)
            sb.table("prospect_tags").update(
                {
                    "locked_by": rep_a_id,
                    "locked_at": dt.datetime.now(tz=dt.UTC).isoformat(),
                }
            ).eq("id", row_id).execute()
        else:
            row_id = _attach_tag(sb, prospect_id, vocab_id, created_by=None)
        tag_row_ids[f"{axis}:{value}"] = row_id

    # Insert pending vocab fixtures with rep_a as creator. The
    # on_rep_tag_vocab_insert trigger only fires when auth.uid() is set,
    # so for service-role planting we INSERT directly with explicit
    # status='pending_admin_review' and created_by=rep_a.
    pending_vocab_ids: dict[str, str] = {}
    for fix in PENDING_VOCAB_FIXTURES:
        res = (
            sb.table("tag_vocabulary")
            .insert(
                {
                    "axis": fix["axis"],
                    "value": fix["value"],
                    "status": "pending_admin_review",
                    "created_by": rep_a_id,
                }
            )
            .execute()
        )
        pending_vocab_ids[f"{fix['axis']}:{fix['value']}"] = res.data[0]["id"]

    # Fan out tag_vocab_pending notifications to admins for the planted
    # pending vocabs (the trigger only fires under auth.uid()).
    admin_ids = [admin_id]
    for vid in pending_vocab_ids.values():
        for a_id in admin_ids:
            sb.table("notifications").insert(
                {
                    "recipient_id": a_id,
                    "kind": "tag_vocab_pending",
                    "actor_id": rep_a_id,
                    "payload": {
                        "tag_id": vid,
                        "creators": [rep_a_id],
                        "prospect_ids": [],
                    },
                }
            ).execute()

    snapshot = {
        "stage_started_at": started,
        "admin_id": admin_id,
        "rep_a_id": rep_a_id,
        "rep_a_email": REP_A_EMAIL,
        "rep_a_password": REP_PASSWORD,
        "rep_b_id": rep_b_id,
        "rep_b_email": REP_B_EMAIL,
        "rep_b_password": REP_PASSWORD,
        "prospect_id": prospect_id,
        "tag_row_ids": tag_row_ids,
        "pending_vocab_ids": pending_vocab_ids,
        "fixture_prospect_payload": payload,
    }
    SNAPSHOT_PATH.parent.mkdir(parents=True, exist_ok=True)
    SNAPSHOT_PATH.write_text(json.dumps(snapshot, indent=2, sort_keys=True))
    print(f"Plant complete. Snapshot: {SNAPSHOT_PATH}")
    print(f"  prospect_id: {prospect_id}")
    print(f"  tag_row_ids: {len(tag_row_ids)}")
    print(f"  pending_vocab_ids: {len(pending_vocab_ids)}")
    print(f"  reps: {rep_a_id} (a) + {rep_b_id} (b)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
