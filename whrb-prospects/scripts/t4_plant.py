#!/usr/bin/env python3
"""Stage T4 plant — instrumentation, dashboard, /guide, /media-kit, and
changelog fixtures. Snapshot lives at ``cache/t4_snapshot.json``.

Plants:
  - 3 fixture prospects later marked `state='sold'` to drive close-rate
    math for source `osm` (T01).
  - 5 synthetic dedupe_match events tagging `losing_source='yelp'` /
    `winning_source='osm'` (T02).
  - 10 filter_impressions rows over a single fixture prospect, half with
    a non-default filter_signature, to drive searched_rate (T03/T04/T05).
  - 1 backdated event_log row per retention bucket (T18).
  - 2 source_config rows in transitional states with rigged
    status_changed_at to test auto-promotion (T19).
  - 1 changelog_entries row (audience='rep') for T21/T22.
  - 1 fixture prospect named 'Boston Symphony Orchestra' for the
    featured-client name-match test (T28).
  - 1 synthetic rep for impression RLS testing.

Idempotent: refuses to re-run while ``cache/t4_snapshot.json`` exists.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import sys
import uuid
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

SNAPSHOT_PATH = WHRB / "cache" / "t4_snapshot.json"

ADMIN_EMAIL = "kingyareh@gmail.com"
REP_EMAIL = "t4-rep@example.com"
REP_PASSWORD = os.environ.get("T4_FIXTURE_PASSWORD", "t4-fixture-password-q7n3")


CLOSED_STATES = {"sold", "ongoing_contact"}


def _client():
    return create_client(SUPABASE_URL, SERVICE_KEY)


def _ensure_user(sb, email: str, password: str, role: str | None = None) -> str:
    page = sb.auth.admin.list_users()
    users = page if isinstance(page, list) else getattr(page, "users", []) or []
    for u in users:
        u_email = getattr(u, "email", None) or (
            u.get("email") if isinstance(u, dict) else None
        )
        if u_email == email:
            uid = getattr(u, "id", None) or (
                u.get("id") if isinstance(u, dict) else None
            )
            return uid
    res = sb.auth.admin.create_user(
        {"email": email, "password": password, "email_confirm": True}
    )
    user = res.user if hasattr(res, "user") else res.get("user")
    uid = user.id if hasattr(user, "id") else user.get("id")
    if role:
        sb.table("profiles").update({"role": role}).eq("id", uid).execute()
    return uid


def main() -> int:
    if SNAPSHOT_PATH.exists():
        print(f"REFUSE: {SNAPSHOT_PATH} exists. Run t4_cleanup.py first.")
        return 1

    sb = _client()
    started = dt.datetime.now(tz=dt.UTC).isoformat()

    rep_id = _ensure_user(sb, REP_EMAIL, REP_PASSWORD, role="rep")
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

    # ---- 1. Three fixture prospects with source='osm' to be marked sold.
    sold_prospect_ids: list[str] = []
    for i in range(3):
        payload = {
            "company_name": f"T4 Fixture Sold {i}",
            "tier": "B",
            "state": "sold",
            "created_source": "manual",
            "source": "osm",
            "category": "amenity=arts_centre",
            "zip": "02138",
        }
        payload["business_key"] = compute_business_key(payload)
        res = sb.table("prospects").insert(payload).execute()
        sold_prospect_ids.append(res.data[0]["id"])

    # ---- 2. Five synthetic dedupe_match events: yelp losing to osm.
    dedupe_event_ids: list[str] = []
    for i in range(5):
        res = (
            sb.table("event_log")
            .insert(
                {
                    "source": "pipeline",
                    "level": "info",
                    "category": "dedupe_match",
                    "message": f"T4 fixture dedupe_match {i}",
                    "context": {
                        "winning_source": "osm",
                        "losing_source": "yelp",
                        "business_key": f"t4-fixture-{i}",
                        "fixture": "t4_plant",
                    },
                }
            )
            .execute()
        )
        dedupe_event_ids.append(res.data[0]["id"])

    # ---- 3. Ten filter_impressions over a single new fixture prospect,
    #         half with a "searched" filter_signature.
    impr_prospect_payload = {
        "company_name": "T4 Fixture Impression Anchor",
        "tier": "C",
        "state": "researching",
        "created_source": "manual",
        "source": "osm",
        "category": "amenity=arts_centre",
        "zip": "02138",
    }
    impr_prospect_payload["business_key"] = compute_business_key(impr_prospect_payload)
    impr_anchor = (
        sb.table("prospects").insert(impr_prospect_payload).execute().data[0]["id"]
    )
    impression_ids: list[str] = []
    # Server-side INSERT bypasses RLS for service-role; the daily-unique
    # index would collapse same-day inserts under a single (user, prospect, day)
    # so we vary user_id between rep + admin to get 2 rows for today, then
    # plant 8 more rows under different created_at days so we have
    # impressions across multiple distinct dates.
    today = dt.datetime.now(tz=dt.UTC)
    for i in range(10):
        # Spread across 5 distinct UTC days to dodge the daily-unique index.
        day_offset = i % 5
        sig = f"q=fixture&page={i}" if i % 2 == 0 else None
        actor_id = rep_id if i % 2 == 0 else admin_id
        created_at = (today - dt.timedelta(days=day_offset)).isoformat()
        res = (
            sb.table("filter_impressions")
            .insert(
                {
                    "user_id": actor_id,
                    "prospect_id": impr_anchor,
                    "filter_signature": sig,
                    "created_at": created_at,
                }
            )
            .execute()
        )
        if res.data:
            impression_ids.append(res.data[0]["id"])

    # ---- 4. Backdated event_log rows per retention bucket.
    backdated_event_ids: dict[str, str] = {}
    bucket_specs = [
        ("errors_old", "error", None, 200),  # >180d → errors bucket
        ("audit_old", "info", "prospect_change", 200),
        ("instrumentation_old", "info", "tag_sync", 100),  # >90d
        ("pipeline_debug_old", "debug", "pipeline_run", 100),
        ("default_old", "info", "feedback_status_change", 100),
    ]
    for label, level, category, days_ago in bucket_specs:
        backdate = (today - dt.timedelta(days=days_ago)).isoformat()
        payload = {
            "source": "pipeline",
            "level": level,
            "category": category,
            "message": f"T4 fixture backdated {label}",
            "context": {"fixture": "t4_plant", "label": label},
            "created_at": backdate,
        }
        res = sb.table("event_log").insert(payload).execute()
        backdated_event_ids[label] = res.data[0]["id"]

    # ---- 5. Two source_config rows in transitional states. We use brand-new
    #         synthetic source keys that won't collide with the live config.
    transitional_keys = {
        "sunset_proposed_ripe": (today - dt.timedelta(days=16)).isoformat(),
        "sunset_ripe": (today - dt.timedelta(days=31)).isoformat(),
    }
    for source_key, status_changed_at in transitional_keys.items():
        target_status = (
            "sunset_proposed" if source_key == "sunset_proposed_ripe" else "sunset"
        )
        sb.table("source_config").upsert(
            {
                "source_key": f"t4_fixture_{source_key}",
                "enabled": False,
                "status": target_status,
                "status_changed_at": status_changed_at,
            }
        ).execute()

    # ---- 6. Changelog entry, audience='rep'.
    changelog_slug = f"t4-launch-{uuid.uuid4().hex[:8]}"
    changelog_res = (
        sb.table("changelog_entries")
        .insert(
            {
                "slug": changelog_slug,
                "title": "T4 launch — instrumentation + media kit",
                "body_mdx": (
                    "Source-quality metrics on /admin/sources, three new "
                    "home dashboard tiles, the /guide content fill, and the "
                    "/media-kit print-+-interactive surface. See the rate "
                    "card and signal map under Media Kit in the nav."
                ),
                "audience": "rep",
                "released_at": today.isoformat(),
                "pinned": True,
                "created_by": admin_id,
            }
        )
        .execute()
    )
    changelog_id = changelog_res.data[0]["id"]

    # Reset the rep's last_changelog_ack so the toast fires for them.
    sb.table("profiles").update(
        {"last_changelog_ack": (today - dt.timedelta(days=1)).isoformat()}
    ).eq("id", rep_id).execute()

    # ---- 7. Featured-client name-match fixture: BSO row.
    bso_payload = {
        "company_name": "Boston Symphony Orchestra",
        "tier": "A",
        "state": "ongoing_contact",
        "created_source": "manual",
        "source": "program_books",
        "category": "amenity=arts_centre",
        "zip": "02115",
    }
    bso_payload["business_key"] = compute_business_key(bso_payload)
    bso_id = sb.table("prospects").insert(bso_payload).execute().data[0]["id"]

    snapshot = {
        "stage_started_at": started,
        "admin_id": admin_id,
        "rep_id": rep_id,
        "rep_email": REP_EMAIL,
        "rep_password": REP_PASSWORD,
        "sold_prospect_ids": sold_prospect_ids,
        "dedupe_event_ids": dedupe_event_ids,
        "impr_anchor": impr_anchor,
        "impression_ids": impression_ids,
        "backdated_event_ids": backdated_event_ids,
        "transitional_source_keys": [
            "t4_fixture_sunset_proposed_ripe",
            "t4_fixture_sunset_ripe",
        ],
        "changelog_id": changelog_id,
        "changelog_slug": changelog_slug,
        "bso_id": bso_id,
    }
    SNAPSHOT_PATH.parent.mkdir(parents=True, exist_ok=True)
    SNAPSHOT_PATH.write_text(json.dumps(snapshot, indent=2, sort_keys=True))
    print(f"Plant complete. Snapshot: {SNAPSHOT_PATH}")
    print(
        f"  sold prospects: {len(sold_prospect_ids)}, "
        f"dedupe events: {len(dedupe_event_ids)}, "
        f"impressions: {len(impression_ids)}, "
        f"backdated: {len(backdated_event_ids)}, "
        f"transitional sources: 2, changelog: 1, BSO: {bso_id}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
