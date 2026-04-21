#!/usr/bin/env python3
"""Stage 8 plant — pick 20 rows + snapshot + planned-edit catalog.

This script does NOT mutate the DB on its own. The 20 edits are applied later
through the web UI via chrome-devtools MCP (round-5 §18.3 decision). The plant
captures:

  cache/stage8_snapshot.json
    {
      started_at_iso, admin_id, rep_a_id, rep_b_id, marker,
      groups: {
        pickup_state:  [ {row_id, business_key, pre_assigned_to, pre_state,
                          target_assigned_to, target_state}, ... ]   x5
        phone_lock:    [ {row_id, business_key, pre_phone, target_phone,
                          pre_user_overrides}, ... ]                 x5
        notes:         [ {row_id, business_key, body, author_email}, ... ] x5
        nonprofit_lock:[ {row_id, business_key, pre_is_nonprofit,
                          pre_nonprofit_source, pre_ein,
                          target_is_nonprofit, target_nonprofit_source,
                          pre_user_overrides}, ... ]                 x3
        email_lock:    [ {row_id, business_key, pre_email, target_email,
                          pre_user_overrides}, ... ]                 x2
      }
    }

  cache/stage8_change_log.jsonl
    One record per planned edit (25 total: 5+5+5+5+3+2). Used as the manual
    checklist when driving chrome-devtools MCP through the plant.

T01 (integrity) succeeds when every planned edit has been applied — verified
later by stage8_integrity.py reading both files.

Exits non-zero if the entry-state preflight fails (missing rep, dirty DB).

Idempotent: refuses to run if cache/stage8_snapshot.json already exists. Run
stage8_cleanup.py first.
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

CACHE_DIR = WHRB / "cache"
SNAPSHOT_PATH = CACHE_DIR / "stage8_snapshot.json"
CHANGE_LOG_PATH = CACHE_DIR / "stage8_change_log.jsonl"

CACHE_MARKER = "stage8_plant_v1"

ADMIN_EMAIL = "kingyareh@gmail.com"
REP_A_EMAIL = "stage7-rep-a@example.com"
REP_B_EMAIL = "stage7-rep-b@example.com"

# Canonical seeds we exclude from the picker so we don't disturb them.
CANONICAL_SEEDS = {
    "Boston Ballet",
    "Museum of Fine Arts",
    "Boston Symphony Orchestra",
    "Massachusetts Bay Transportation Authority",
}

# Counts of rows per group — 20 distinct prospect rows total. Edits per row
# vary: pickup_state rows take 2 actions each (assign + state), the others
# take 1 each. Total actions = 5+5+5+5+3+2 = 25 (matches plan §6.4).
GROUP_SIZES = {
    "pickup_state": 5,
    "phone_lock": 5,
    "notes": 5,
    "nonprofit_lock": 3,
    "email_lock": 2,
}

TARGET_STATE = "initial_contact"

# Deterministic target values per slot index — keep them out-of-band so a
# scraped value cannot accidentally match the "edited" value.
def _target_phone(i: int) -> str:
    return f"555-S8-PHONE-{i:02d}"


def _target_email(i: int) -> str:
    return f"stage8-locked-{i:02d}@whrb-test.local"


def _note_body(i: int) -> str:
    return f"[{CACHE_MARKER}] Stage 8 contract-test note #{i:02d} — must survive both reruns."


def _client():
    return create_client(SUPABASE_URL, SERVICE_KEY)


def _get_profile(client, email: str) -> dict[str, Any]:
    res = (
        client.table("profiles")
        .select("id,email,role")
        .ilike("email", email)
        .limit(1)
        .execute()
    )
    if not res.data:
        raise SystemExit(f"Plant aborted: profile missing for {email}")
    return res.data[0]


def _ensure_clean_entry(client) -> None:
    if SNAPSHOT_PATH.exists():
        raise SystemExit(
            f"Plant refused: {SNAPSHOT_PATH} already exists. "
            "Run scripts/stage8_cleanup.py before re-planting."
        )
    # Confirm DB is in a clean entry state per §18.2.
    locks = (
        client.table("prospects")
        .select("id", count="exact", head=True)
        .neq("user_overrides", {})
        .execute()
    )
    if (locks.count or 0) > 0:
        raise SystemExit(
            f"Plant refused: {locks.count} prospects already have non-empty "
            "user_overrides. Investigate before planting Stage 8."
        )
    notes = (
        client.table("prospect_notes")
        .select("id", count="exact", head=True)
        .execute()
    )
    if (notes.count or 0) > 0:
        raise SystemExit(
            f"Plant refused: prospect_notes is not empty ({notes.count} rows)."
        )
    # event_log clean since Stage 7 exit (2026-04-20T11:00Z is conservative).
    errs = (
        client.table("event_log")
        .select("id", count="exact", head=True)
        .in_("level", ["error", "fatal"])
        .gte("created_at", "2026-04-20T11:00:00Z")
        .execute()
    )
    if (errs.count or 0) > 0:
        raise SystemExit(
            f"Plant refused: {errs.count} error/fatal event_log rows since Stage 7. "
            "Investigate."
        )


def _select_candidates(client, want: int, *, where, used: set[str]) -> list[dict]:
    """Page through prospects until we have `want` rows that match `where`,
    are not in `used`, and are not canonical seeds. Pages by id (deterministic).
    Bumps the offset past every row we examine so reused queries do not
    re-traverse the same prefix.
    """
    out: list[dict] = []
    offset = 0
    page = 500
    while len(out) < want:
        q = (
            client.table("prospects")
            .select(
                "id,business_key,company_name,company_phone,company_email,"
                "is_nonprofit,nonprofit_source,ein,state,assigned_to,"
                "user_overrides,tier,priority_score"
            )
            .eq("created_source", "pipeline")
            .order("id")
            .range(offset, offset + page - 1)
        )
        q = where(q)
        rows = q.execute().data or []
        if not rows:
            break
        for row in rows:
            if row["id"] in used:
                continue
            if row.get("company_name") in CANONICAL_SEEDS:
                continue
            out.append(row)
            if len(out) >= want:
                break
        offset += page
    return out


def _pick(candidates: list[dict], want: int, used: set[str]) -> list[dict]:
    """Mark the first `want` candidates as used and return them."""
    out: list[dict] = []
    for row in candidates:
        if row["id"] in used:
            continue
        out.append(row)
        used.add(row["id"])
        if len(out) >= want:
            break
    if len(out) < want:
        raise SystemExit(
            f"Plant aborted: needed {want} rows, found {len(out)} candidates."
        )
    return out


def _flip_nonprofit(row: dict) -> tuple[bool, str]:
    """Decide the post-edit (is_nonprofit, nonprofit_source) target.

    A user override on is_nonprofit always sets nonprofit_source='manual' per
    plan §5.6. We flip the boolean from whatever the row currently shows so
    the change is observable.
    """
    pre = bool(row.get("is_nonprofit"))
    return (not pre, "manual")


def main() -> int:
    client = _client()
    _ensure_clean_entry(client)

    admin = _get_profile(client, ADMIN_EMAIL)
    rep_a = _get_profile(client, REP_A_EMAIL)
    rep_b = _get_profile(client, REP_B_EMAIL)

    started_at_iso = dt.datetime.now(dt.UTC).isoformat()

    used: set[str] = set()
    snapshot: dict[str, Any] = {
        "started_at_iso": started_at_iso,
        "marker": CACHE_MARKER,
        "admin_id": admin["id"],
        "admin_email": admin["email"],
        "rep_a_id": rep_a["id"],
        "rep_a_email": rep_a["email"],
        "rep_b_id": rep_b["id"],
        "rep_b_email": rep_b["email"],
        "groups": {},
    }

    # ---- Group 1: pickup_state (5 rows, Rep A picks up + sets state) ----
    cand = _select_candidates(
        client,
        GROUP_SIZES["pickup_state"] * 4,
        where=lambda q: q.is_("assigned_to", "null").eq("state", "researching"),
        used=used,
    )
    pickup_rows = _pick(cand, GROUP_SIZES["pickup_state"], used)
    snapshot["groups"]["pickup_state"] = [
        {
            "row_id": r["id"],
            "business_key": r["business_key"],
            "company_name": r.get("company_name"),
            "pre_assigned_to": r.get("assigned_to"),
            "pre_state": r.get("state"),
            "target_assigned_to": rep_a["id"],
            "target_state": TARGET_STATE,
            "actor_email": REP_A_EMAIL,
        }
        for r in pickup_rows
    ]

    # ---- Group 2: phone_lock (5 rows, admin patches company_phone + lock) ----
    cand = _select_candidates(
        client,
        GROUP_SIZES["phone_lock"] * 4,
        where=lambda q: q.not_.is_("company_phone", "null"),
        used=used,
    )
    phone_rows = _pick(cand, GROUP_SIZES["phone_lock"], used)
    snapshot["groups"]["phone_lock"] = [
        {
            "row_id": r["id"],
            "business_key": r["business_key"],
            "company_name": r.get("company_name"),
            "pre_phone": r.get("company_phone"),
            "pre_user_overrides": r.get("user_overrides") or {},
            "target_phone": _target_phone(i),
            "actor_email": ADMIN_EMAIL,
        }
        for i, r in enumerate(phone_rows, start=1)
    ]

    # ---- Group 3: notes (5 rows, alternating Rep A / Rep B) ----
    cand = _select_candidates(
        client,
        GROUP_SIZES["notes"] * 4,
        where=lambda q: q,
        used=used,
    )
    note_rows = _pick(cand, GROUP_SIZES["notes"], used)
    snapshot["groups"]["notes"] = [
        {
            "row_id": r["id"],
            "business_key": r["business_key"],
            "company_name": r.get("company_name"),
            "body": _note_body(i),
            "author_email": REP_A_EMAIL if i % 2 == 1 else REP_B_EMAIL,
            "author_id": rep_a["id"] if i % 2 == 1 else rep_b["id"],
        }
        for i, r in enumerate(note_rows, start=1)
    ]

    # ---- Group 4: nonprofit_lock (3 rows, admin sets is_nonprofit override) ----
    cand = _select_candidates(
        client,
        GROUP_SIZES["nonprofit_lock"] * 4,
        where=lambda q: q,
        used=used,
    )
    np_rows = _pick(cand, GROUP_SIZES["nonprofit_lock"], used)
    np_entries = []
    for r in np_rows:
        target_flag, target_src = _flip_nonprofit(r)
        np_entries.append(
            {
                "row_id": r["id"],
                "business_key": r["business_key"],
                "company_name": r.get("company_name"),
                "pre_is_nonprofit": r.get("is_nonprofit"),
                "pre_nonprofit_source": r.get("nonprofit_source"),
                "pre_ein": r.get("ein"),
                "pre_user_overrides": r.get("user_overrides") or {},
                "target_is_nonprofit": target_flag,
                "target_nonprofit_source": target_src,
                "actor_email": ADMIN_EMAIL,
            }
        )
    snapshot["groups"]["nonprofit_lock"] = np_entries

    # ---- Group 5: email_lock (2 rows, admin patches company_email + lock) ----
    cand = _select_candidates(
        client,
        GROUP_SIZES["email_lock"] * 4,
        where=lambda q: q.not_.is_("company_email", "null"),
        used=used,
    )
    email_rows = _pick(cand, GROUP_SIZES["email_lock"], used)
    snapshot["groups"]["email_lock"] = [
        {
            "row_id": r["id"],
            "business_key": r["business_key"],
            "company_name": r.get("company_name"),
            "pre_email": r.get("company_email"),
            "pre_user_overrides": r.get("user_overrides") or {},
            "target_email": _target_email(i),
            "actor_email": ADMIN_EMAIL,
        }
        for i, r in enumerate(email_rows, start=1)
    ]

    CACHE_DIR.mkdir(exist_ok=True)
    SNAPSHOT_PATH.write_text(json.dumps(snapshot, indent=2, default=str))

    # change_log.jsonl: 25 lines (one per planned edit), in execution order.
    lines: list[dict] = []
    for entry in snapshot["groups"]["pickup_state"]:
        lines.append(
            {
                "kind": "assign",
                "actor_email": entry["actor_email"],
                "row_id": entry["row_id"],
                "company_name": entry["company_name"],
                "target_assigned_to": entry["target_assigned_to"],
            }
        )
        lines.append(
            {
                "kind": "state",
                "actor_email": entry["actor_email"],
                "row_id": entry["row_id"],
                "company_name": entry["company_name"],
                "target_state": entry["target_state"],
            }
        )
    for entry in snapshot["groups"]["phone_lock"]:
        lines.append(
            {
                "kind": "phone_edit",
                "actor_email": entry["actor_email"],
                "row_id": entry["row_id"],
                "company_name": entry["company_name"],
                "target_phone": entry["target_phone"],
            }
        )
    for entry in snapshot["groups"]["notes"]:
        lines.append(
            {
                "kind": "note_add",
                "actor_email": entry["author_email"],
                "row_id": entry["row_id"],
                "company_name": entry["company_name"],
                "body": entry["body"],
            }
        )
    for entry in snapshot["groups"]["nonprofit_lock"]:
        lines.append(
            {
                "kind": "nonprofit_edit",
                "actor_email": entry["actor_email"],
                "row_id": entry["row_id"],
                "company_name": entry["company_name"],
                "target_is_nonprofit": entry["target_is_nonprofit"],
                "target_nonprofit_source": entry["target_nonprofit_source"],
            }
        )
    for entry in snapshot["groups"]["email_lock"]:
        lines.append(
            {
                "kind": "email_edit",
                "actor_email": entry["actor_email"],
                "row_id": entry["row_id"],
                "company_name": entry["company_name"],
                "target_email": entry["target_email"],
            }
        )

    CHANGE_LOG_PATH.write_text("\n".join(json.dumps(line) for line in lines) + "\n")

    n_rows = sum(len(g) for g in snapshot["groups"].values())
    print(
        f"[plant] snapshot -> {SNAPSHOT_PATH}\n"
        f"[plant] change_log -> {CHANGE_LOG_PATH}\n"
        f"[plant] groups: pickup={len(snapshot['groups']['pickup_state'])} "
        f"phone={len(snapshot['groups']['phone_lock'])} "
        f"notes={len(snapshot['groups']['notes'])} "
        f"nonprofit={len(snapshot['groups']['nonprofit_lock'])} "
        f"email={len(snapshot['groups']['email_lock'])} "
        f"total_rows={n_rows} planned_edits={len(lines)}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
