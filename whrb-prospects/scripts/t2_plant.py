#!/usr/bin/env python3
"""Stage T2 plant — fixtures for the tag-emitter + cannabis-block run.

Seeds:
  - Six fixture prospects representing every cannabis-block scenario:
      1. ``T2 Fixture CCC Match``        — name matches an overlay entry; blocked
      2. ``T2 Indica Lounge``            — "indica" in the name; NOT in CCC → kept
      3. ``T2 Address Twin``             — shares an address with a known CCC row
                                           but has a totally unrelated name → kept
      4. ``T2 OSM Cannabis``             — ``category='shop=cannabis'`` → blocked
      5. ``T2 Clean Prospect A``         — ordinary Tier B retail
      6. ``T2 Clean Prospect B``         — ordinary Tier C home-services
  - A locked ``genre:jazz`` tag planted on T1's fixture prospect, under
    T2_LOCK_USER_EMAIL (reuses T1's synthetic rep if present).
  - Overlay file ``data/ccc_manual_blocklist.txt`` is temporarily extended
    so the T01 "CCC match blocks row" test doesn't depend on the live
    CCC feed. Cleanup restores it to the exact bytes present at plant.

Snapshot at ``cache/t2_snapshot.json`` captures:
    stage_started_at, admin_id, rep_id, rep_email, rep_password,
    prospect_id (T1 fixture), locked_tag_row_id (prospect_tags PK), the
    fixture prospect IDs by label, the overlay checksum, the pre-stage
    prospect_tags count, and the current vocab IDs needed for cleanup.

Idempotent: refuses to run if ``cache/t2_snapshot.json`` already exists.
"""
from __future__ import annotations

import datetime as dt
import hashlib
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

SNAPSHOT_PATH = WHRB / "cache" / "t2_snapshot.json"
OVERLAY_PATH = WHRB / "data" / "ccc_manual_blocklist.txt"

ADMIN_EMAIL = "kingyareh@gmail.com"
REP_EMAIL = "t2-rep@example.com"
REP_PASSWORD = os.environ.get(
    "T2_FIXTURE_PASSWORD", "t2-fixture-password-x7q2"
)

# Fixture prospect definitions. ``business_key`` is computed from
# ``company_name`` + ``zip`` via ``db.supabase_sync.business_key()`` so
# ``tag_sync`` can resolve the fixture by the same key the CLI emits.
_FIXTURE_SEEDS: dict[str, dict] = {
    "ccc_name_match": {
        "company_name": "T2 Fixture CCC Match",
        "tier": "B",
        "state": "researching",
        "created_source": "manual",
        "source": "osm",
        "category": "amenity=bar",
        "zip": "02139",
    },
    "indica_false_positive": {
        "company_name": "T2 Indica Lounge",
        "tier": "B",
        "state": "researching",
        "created_source": "manual",
        "source": "osm",
        "category": "amenity=bar",
        "zip": "02139",
    },
    "address_twin": {
        "company_name": "T2 Address Twin Gallery",
        "tier": "B",
        "state": "researching",
        "created_source": "manual",
        "source": "osm",
        "category": "amenity=arts_centre",
        "address": "1764 Main Street, Leicester, MA 01524",  # shared w/ CCC row
        "zip": "01524",
    },
    "osm_cannabis": {
        "company_name": "T2 OSM Cannabis",
        "tier": "B",
        "state": "researching",
        "created_source": "manual",
        "source": "osm",
        "category": "shop=cannabis",
        "zip": "02139",
    },
    "clean_retail": {
        "company_name": "T2 Clean Prospect A",
        "tier": "B",
        "state": "researching",
        "created_source": "manual",
        "source": "osm",
        "category": "shop=books",
        "zip": "02139",
    },
    "clean_home_services": {
        "company_name": "T2 Clean Prospect B",
        "tier": "C",
        "state": "researching",
        "created_source": "manual",
        "source": "ma_hic_legacy",
        "category": "home_improvement_contractor",
        "zip": "02143",
    },
}


def _with_business_key(payload: dict) -> dict:
    bk = compute_business_key(payload)
    if not bk:
        raise RuntimeError(
            f"fixture could not derive a business_key: {payload!r}"
        )
    return {**payload, "business_key": bk}


FIXTURE_PROSPECTS: dict[str, dict] = {
    label: _with_business_key(payload)
    for label, payload in _FIXTURE_SEEDS.items()
}

# Overlay addition planted for the CCC-match fixture. Restored on cleanup.
OVERLAY_MARKER = "# --- T2 PLANT OVERLAY (auto-added; removed on cleanup) ---"
OVERLAY_ADDITION = "T2 Fixture CCC Match"


def _client():
    return create_client(SUPABASE_URL, SERVICE_KEY)


def _extend_overlay(marker: str, name: str) -> str:
    """Append a planted name to the overlay file and return its pre-hash."""
    before = OVERLAY_PATH.read_bytes() if OVERLAY_PATH.exists() else b""
    pre_hash = hashlib.sha256(before).hexdigest()
    block = f"\n{marker}\n{name}\n{marker}\n"
    with OVERLAY_PATH.open("a", encoding="utf-8") as fh:
        fh.write(block)
    return pre_hash


def main() -> int:
    if SNAPSHOT_PATH.exists():
        print(
            f"Refusing to plant — snapshot already exists at {SNAPSHOT_PATH}.\n"
            "Run scripts/t2_cleanup.py first.",
            file=sys.stderr,
        )
        return 2

    SNAPSHOT_PATH.parent.mkdir(parents=True, exist_ok=True)
    sb = _client()

    # Admin must exist.
    admin = (
        sb.table("profiles")
        .select("id,email,role")
        .eq("email", ADMIN_EMAIL)
        .execute()
        .data
    )
    if not admin or admin[0]["role"] != "admin":
        print(f"Admin {ADMIN_EMAIL} missing or not admin.", file=sys.stderr)
        return 1
    admin_id = admin[0]["id"]

    # Reuse T1's rep if present; otherwise create a dedicated T2 rep.
    existing_rep = (
        sb.table("profiles")
        .select("id,email,role")
        .eq("email", REP_EMAIL)
        .execute()
        .data
    )
    if existing_rep:
        rep_id = existing_rep[0]["id"]
        print(f"Rep already present: {rep_id}")
    else:
        created = sb.auth.admin.create_user(
            {"email": REP_EMAIL, "password": REP_PASSWORD, "email_confirm": True}
        )
        rep_id = created.user.id
        print(f"Created synthetic T2 rep: {rep_id}")

    # Fixture prospects.
    fixture_ids: dict[str, str] = {}
    for label, payload in FIXTURE_PROSPECTS.items():
        existing = (
            sb.table("prospects")
            .select("id,business_key")
            .eq("business_key", payload["business_key"])
            .execute()
            .data
        )
        if existing:
            fixture_ids[label] = existing[0]["id"]
            continue
        res = sb.table("prospects").insert(payload).execute()
        fixture_ids[label] = res.data[0]["id"]
        print(f"Planted {label}: {fixture_ids[label]}")

    # Locked genre:jazz on T1's fixture prospect if present, else on T2's
    # ``clean_home_services`` fixture so T09a always has a locked-tag target.
    locked_tag_row_id: str | None = None
    t1_prospect = (
        sb.table("prospects")
        .select("id")
        .eq("business_key", "t1-fixture-merge-prospect")
        .execute()
        .data
    )
    if not t1_prospect:
        t1_prospect = [{"id": fixture_ids["clean_home_services"]}]
        print(
            "Falling back to clean_home_services fixture for T09a locked-tag target."
        )
    if t1_prospect:
        jazz_vocab = (
            sb.table("tag_vocabulary")
            .select("id")
            .eq("axis", "genre")
            .eq("value", "jazz")
            .execute()
            .data
        )
        if jazz_vocab:
            # Upsert — the unique constraint protects against double-plant.
            ins = (
                sb.table("prospect_tags")
                .upsert(
                    {
                        "prospect_id": t1_prospect[0]["id"],
                        "tag_id": jazz_vocab[0]["id"],
                        "created_by": rep_id,
                        "locked_by": rep_id,
                        "locked_at": dt.datetime.now(dt.UTC).isoformat(),
                    },
                    on_conflict="prospect_id,tag_id",
                )
                .execute()
            )
            if ins.data:
                locked_tag_row_id = ins.data[0]["id"]
            else:
                existing_row = (
                    sb.table("prospect_tags")
                    .select("id,locked_by")
                    .eq("prospect_id", t1_prospect[0]["id"])
                    .eq("tag_id", jazz_vocab[0]["id"])
                    .execute()
                    .data
                )
                if existing_row:
                    locked_tag_row_id = existing_row[0]["id"]
                    # Ensure locked_by stays on our rep so T09 tests work.
                    if existing_row[0].get("locked_by") != rep_id:
                        sb.table("prospect_tags").update(
                            {
                                "locked_by": rep_id,
                                "locked_at": dt.datetime.now(dt.UTC).isoformat(),
                            }
                        ).eq("id", locked_tag_row_id).execute()

    # Pre-stage prospect_tags count.
    count_res = (
        sb.table("prospect_tags")
        .select("id", count="exact", head=True)
        .execute()
    )
    pre_count = count_res.count or 0

    # Overlay planting — the T01 CCC-match test leans on this without
    # requiring the live CCC CSV to list our fixture row.
    overlay_prehash = _extend_overlay(OVERLAY_MARKER, OVERLAY_ADDITION)

    snapshot = {
        "schema_version": "t2_plant_v1",
        "stage_started_at": dt.datetime.now(dt.UTC).isoformat(),
        "admin_id": admin_id,
        "rep_id": rep_id,
        "rep_email": REP_EMAIL,
        "rep_password": REP_PASSWORD,
        "fixture_prospect_ids": fixture_ids,
        # ``locked_tag_prospect_id`` is the prospect the locked jazz tag is
        # planted on — either the T1 fixture when present, or the T2
        # clean_home_services fallback.
        "locked_tag_prospect_id": t1_prospect[0]["id"] if t1_prospect else None,
        "locked_tag_row_id": locked_tag_row_id,
        "prospect_tags_pre_count": pre_count,
        "overlay_prehash_sha256": overlay_prehash,
        "overlay_marker": OVERLAY_MARKER,
    }
    SNAPSHOT_PATH.write_text(json.dumps(snapshot, indent=2))
    print(f"Wrote snapshot to {SNAPSHOT_PATH}")
    print(f"Pre-stage prospect_tags count: {pre_count:,}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
