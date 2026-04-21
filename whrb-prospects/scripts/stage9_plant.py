#!/usr/bin/env python3
"""Stage 9 plant — fixtures for the admin-console integrity run.

Writes:
  cache/stage9_snapshot.json — {
    started_at_iso, marker, fixture_password,
    admin_id, synthetic_rep_id, synthetic_rep_email,
    pre_profile_count, pre_feedback_count,
    source_config_pre: [ {source_key, enabled, updated_by}, ... ]  # 9 rows
    city_licenses_snapshot: { pre_last_seen_at_max: ISO }
    invite_email: "Crimsoncowy@gmail.com",
    seeded_feedback_id,
  }

Seeds:
  - One synthetic rep (stage9-rep@example.com) via
    auth.admin.create_user(email_confirm=True, password=...) — same approach
    Stage 7 used.
  - Snapshots all 9 source_config rows (for cleanup) and records the
    max(pipeline_last_seen_at) for source='city_licenses' prospects so T04 can
    assert the rerun did not advance them.
  - Toggles source_config.city_licenses.enabled = false (so T01 has its
    expected final value and T04's rerun skips city_licenses).
  - Seeds one feedback row authored by the synthetic rep for T11/T12.

Pre-conditions enforced before mutation:
  - Admin present (role='admin').
  - event_log has 0 rows with level in ('error','fatal') since the Stage-8
    exit timestamp (hard-coded; see STAGE8_EXIT_ISO).

Idempotent: refuses to run if cache/stage9_snapshot.json already exists;
run stage9_cleanup.py first to start over.
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

SNAPSHOT_PATH = WHRB / "cache" / "stage9_snapshot.json"
CACHE_MARKER = "stage9_plant_v1"
FIXTURE_PASSWORD = os.environ.get("STAGE9_FIXTURE_PASSWORD", "stage9-fixture-password-4rvh")

STAGE9_REP = "stage9-rep@example.com"
ADMIN_EMAIL = "kingyareh@gmail.com"
INVITE_TARGET = "Crimsoncowy@gmail.com"

# Stage 8 exit reference — used for the event_log error/fatal precondition.
STAGE8_EXIT_ISO = "2026-04-21T03:08:00Z"


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


def _sanity_errors_since(client, since_iso: str) -> int:
    res = (
        client.table("event_log")
        .select("id", count="exact", head=True)
        .in_("level", ["error", "fatal"])
        .gte("created_at", since_iso)
        .execute()
    )
    return res.count or 0


def _snapshot_source_config(client) -> list[dict[str, Any]]:
    res = (
        client.table("source_config")
        .select("source_key,enabled,updated_by,updated_at,extra_args")
        .order("source_key")
        .execute()
    )
    rows = res.data or []
    return rows


def _boston_food_max_last_seen(client) -> str | None:
    """The `boston_food` subset rows are produced by the `city_licenses`
    scraper (see sources/city_licenses.py::_fetch_boston_food), so we gate
    the rerun assertion against `prospects.source='boston_food'` even
    though the scraper toggle is `source_key='city_licenses'` in
    `source_config`.
    """
    res = (
        client.table("prospects")
        .select("pipeline_last_seen_at")
        .eq("source", "boston_food")
        .not_.is_("pipeline_last_seen_at", "null")
        .order("pipeline_last_seen_at", desc=True)
        .limit(1)
        .execute()
    )
    rows = res.data or []
    if not rows:
        return None
    return rows[0]["pipeline_last_seen_at"]


def _disable_city_licenses(client, admin_id: str) -> None:
    client.table("source_config").update(
        {"enabled": False, "updated_by": admin_id}
    ).eq("source_key", "city_licenses").execute()


def _seed_feedback(client, author_id: str) -> str:
    body = f"[{CACHE_MARKER}] stage9 plant feedback — triage target"
    ins = (
        client.table("feedback")
        .insert(
            {
                "author_id": author_id,
                "category": "data_issue",
                "body": body,
                "page_url": "https://example.com/stage9",
                "user_agent": "stage9-plant/1.0",
                "status": "new",
            }
        )
        .execute()
    )
    return ins.data[0]["id"]


def main() -> int:
    client = _client()

    if SNAPSHOT_PATH.exists():
        raise SystemExit(
            f"stage9 snapshot already exists at {SNAPSHOT_PATH}. "
            "Run stage9_cleanup.py before re-planting."
        )

    admin = _get_profile_by_email(client, ADMIN_EMAIL)
    if not admin:
        raise SystemExit(f"admin profile missing: {ADMIN_EMAIL}")

    err_count = _sanity_errors_since(client, STAGE8_EXIT_ISO)
    if err_count != 0:
        raise SystemExit(
            f"event_log has {err_count} error/fatal rows since {STAGE8_EXIT_ISO}. "
            "Investigate before planting."
        )

    rep_id = _create_rep(client, STAGE9_REP, FIXTURE_PASSWORD)

    # Profile count (pre).
    profile_count_res = (
        client.table("profiles").select("id", count="exact", head=True).execute()
    )
    pre_profile_count = profile_count_res.count or 0

    feedback_count_res = (
        client.table("feedback").select("id", count="exact", head=True).execute()
    )
    pre_feedback_count = feedback_count_res.count or 0

    source_config_pre = _snapshot_source_config(client)
    if len(source_config_pre) != 9:
        raise SystemExit(
            f"expected 9 source_config rows, found {len(source_config_pre)}"
        )

    boston_food_pre_max = _boston_food_max_last_seen(client)
    _disable_city_licenses(client, admin["id"])

    feedback_id = _seed_feedback(client, rep_id)

    started_at_iso = dt.datetime.now(dt.UTC).isoformat()
    snapshot = {
        "started_at_iso": started_at_iso,
        "marker": CACHE_MARKER,
        "fixture_password": FIXTURE_PASSWORD,
        "admin_id": admin["id"],
        "synthetic_rep_id": rep_id,
        "synthetic_rep_email": STAGE9_REP,
        "pre_profile_count": pre_profile_count,
        "pre_feedback_count": pre_feedback_count,
        "source_config_pre": source_config_pre,
        # The source_config scraper key we toggle is `city_licenses`, but
        # the T04 assertion — "no new boston_food rows, existing
        # pipeline_last_seen_at unchanged" — is evaluated against
        # prospects.source='boston_food' (the subset produced by the
        # `city_licenses` scraper per sources/city_licenses.py::_fetch_boston_food).
        "toggled_scraper_key": "city_licenses",
        "boston_food_snapshot": {"pre_last_seen_at_max": boston_food_pre_max},
        "invite_email": INVITE_TARGET,
        "seeded_feedback_id": feedback_id,
    }
    SNAPSHOT_PATH.parent.mkdir(parents=True, exist_ok=True)
    SNAPSHOT_PATH.write_text(json.dumps(snapshot, indent=2, default=str))

    print(
        f"Planted: rep={rep_id} feedback={feedback_id} "
        f"source_config_rows={len(source_config_pre)} "
        f"toggled_scraper=city_licenses "
        f"boston_food_pre_max={boston_food_pre_max} "
        f"started_at={started_at_iso}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
