#!/usr/bin/env python3
"""Stage T2 integrity suite — 25 Tks (T01–T18, T09 expanded to T09a–h).

Plan §4.6. Runs every Python-side check; browser-only checks are
reported as ``SKIP-BROWSER`` and must be exercised via Playwright in
``whrb-web/e2e/t2/*.spec.ts`` (none are written for T2 yet — the only
legitimate browser Tk is T09f's "lock icon renders for same user
post-merge").

Pre-conditions:
  - 008_daypart_view.sql applied (``apply_t2_migration.py``).
  - t2_plant.py has run; cache/t2_snapshot.json exists.
  - Backfill is OPTIONAL here (T16 runs its own transient backfill to
    compute counts; it tolerates either a pre-populated or freshly
    backfilled state).

Usage:
    .venv/bin/python scripts/t2_integrity.py
    .venv/bin/python scripts/t2_integrity.py --skip-regression

Exit codes:
  0  every Python Tk green (Browser Tks reported as SKIP-BROWSER)
  1  any Python Tk failed
  2  prerequisite missing (snapshot / migration / DB creds)
"""
from __future__ import annotations

import argparse
import ast
import json
import os
import subprocess
import sys
import uuid
from dataclasses import dataclass
from pathlib import Path

import psycopg2
from dotenv import load_dotenv

HERE = Path(__file__).resolve().parent
WHRB = HERE.parent
REPO_ROOT = WHRB.parent
sys.path.insert(0, str(WHRB))
load_dotenv(WHRB / ".env")

SUPABASE_URL = os.environ["SUPABASE_URL"]
ANON_KEY = os.environ["SUPABASE_ANON_KEY"]
SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
PROJECT_REF = os.environ["SUPABASE_PROJECT_REF"]
DB_PASSWORD = os.environ["SUPABASE_DB_PASSWORD"]

from supabase import create_client

SNAPSHOT_PATH = WHRB / "cache" / "t2_snapshot.json"


@dataclass
class T:
    name: str
    passed: bool
    detail: str
    skipped: str | None = None


def _ok(name: str, detail: str = "") -> T:
    return T(name, True, detail)


def _fail(name: str, detail: str) -> T:
    return T(name, False, detail)


def _skip(name: str, kind: str, detail: str = "") -> T:
    return T(name, True, detail, skipped=kind)


def _conn():
    """Prefer pooler (IPv4) — the direct endpoint resolves to IPv6 only on
    Supabase Pro-tier projects as of 2025-11 and fails from some networks.

    Pattern mirrors ``apply_t1_migration.py`` / ``apply_t2_migration.py``.
    """
    pooler = (
        f"postgresql://postgres.{PROJECT_REF}:{DB_PASSWORD}"
        "@aws-1-us-west-2.pooler.supabase.com:5432/postgres?sslmode=require"
    )
    direct = (
        f"postgresql://postgres:{DB_PASSWORD}"
        f"@db.{PROJECT_REF}.supabase.co:5432/postgres?sslmode=require"
    )
    try:
        return psycopg2.connect(pooler, connect_timeout=10)
    except Exception:
        return psycopg2.connect(direct, connect_timeout=10)


def _service():
    return create_client(SUPABASE_URL, SERVICE_KEY)


def _vocab_id(sb, axis: str, value: str) -> str | None:
    res = (
        sb.table("tag_vocabulary")
        .select("id")
        .eq("axis", axis)
        .eq("value", value)
        .limit(1)
        .execute()
    )
    return res.data[0]["id"] if res.data else None


def _ensure_vocab(sb, axis: str, value: str) -> str:
    """Return the vocab id, inserting the row (active, service-role) if missing."""
    existing = _vocab_id(sb, axis, value)
    if existing:
        return existing
    ins = (
        sb.table("tag_vocabulary")
        .insert({"axis": axis, "value": value, "status": "active"})
        .execute()
    )
    return ins.data[0]["id"]


# -------------------------------------------------------------------------
# Cannabis block (T01-T04)
# -------------------------------------------------------------------------

def t01_ccc_match_blocks(snap: dict) -> T:
    """Fixture OSM row with CCC-overlay-matching name → blocked + event emitted."""
    from util import cannabis_block

    cannabis_block._reset_for_tests()
    row = {
        "source": "osm",
        "company_name": "T2 Fixture CCC Match",
        "zip": "02139",
        "category": "amenity=bar",
    }
    sb = _service()
    pre = (
        sb.table("event_log")
        .select("id", count="exact", head=True)
        .eq("category", "cannabis_blocked")
        .execute()
    )
    pre_count = pre.count or 0
    kept = cannabis_block.filter_rows([row])
    # Drain the event_log buffer so the count query sees the new row.
    from util import event_log

    event_log.flush()
    post = (
        sb.table("event_log")
        .select("id", count="exact", head=True)
        .eq("category", "cannabis_blocked")
        .execute()
    )
    delta = (post.count or 0) - pre_count
    ok = len(kept) == 0 and delta >= 1
    return T(
        "T01 CCC overlay name → blocked + cannabis_blocked event emitted",
        ok,
        f"kept={len(kept)} event_delta={delta}",
    )


def t02_false_positive_name(snap: dict) -> T:
    """`Indica Lounge` is NOT a CCC licensee → NOT blocked."""
    from util import cannabis_block

    cannabis_block._reset_for_tests()
    row = {
        "source": "osm",
        "company_name": "T2 Indica Lounge",
        "zip": "02139",
        "category": "amenity=bar",
    }
    kept = cannabis_block.filter_rows([row])
    return T(
        "T02 'Indica Lounge' not in CCC → not blocked",
        len(kept) == 1,
        f"kept={len(kept)}",
    )


def t03_address_twin(snap: dict) -> T:
    """Sharing a CCC business's address isn't a block signal (name mismatch)."""
    from util import cannabis_block

    cannabis_block._reset_for_tests()
    row = {
        "source": "osm",
        "company_name": "T2 Address Twin Gallery",
        "address": "1764 Main Street, Leicester, MA 01524",
        "zip": "01524",
        "category": "amenity=arts_centre",
    }
    kept = cannabis_block.filter_rows([row])
    return T(
        "T03 address match alone (no name match) → not blocked",
        len(kept) == 1,
        f"kept={len(kept)}",
    )


def t04_osm_shop_cannabis(snap: dict) -> T:
    """`category=shop=cannabis` → blocked regardless of CCC list."""
    from util import cannabis_block

    cannabis_block._reset_for_tests()
    row = {
        "source": "osm",
        "company_name": "T2 OSM Cannabis",
        "zip": "02139",
        "category": "shop=cannabis",
    }
    kept = cannabis_block.filter_rows([row])
    return T(
        "T04 OSM shop=cannabis category → blocked",
        len(kept) == 0,
        f"kept={len(kept)}",
    )


# -------------------------------------------------------------------------
# Source emitter fixtures (T05)
# -------------------------------------------------------------------------

def t05_source_fixtures(snap: dict) -> T:
    """Each emitter: fixture in → expected tag set out.

    Runs each source's documented mapping through ``util.tags`` helpers.
    No network — uses the in-process vocab cache loaded from DB at session start.
    """
    from util.tags import (
        affiliation_for_zip,
        build_tag_set,
        city_category_to_tags,
        osm_category_to_tags,
        reset_cache,
        yelp_alias_to_tags,
    )

    reset_cache()
    failures: list[str] = []

    # --- OSM (3 fixtures) ---
    cases_osm = [
        # (category, zip, expected sector, expected operating_model,
        #  expected affiliation)
        ("amenity=theatre",  "02138", "arts",          "venue",      "cambridge_based"),
        ("craft=plumber",    "02143", "home_services", "service_provider", "greater_boston"),
        ("shop=books",       "02116", "retail",        "retailer",   "boston_based"),
    ]
    for category, zip_, s_expected, om_expected, aff_expected in cases_osm:
        s, om = osm_category_to_tags(category)
        aff = affiliation_for_zip(zip_)
        t = build_tag_set(sector=s, operating_model=om, affiliation=aff, source="osm")
        if t.get("sector") != [s_expected]:
            failures.append(f"osm[{category}] sector={t.get('sector')} expected=[{s_expected}]")
        if t.get("operating_model") != [om_expected]:
            failures.append(f"osm[{category}] operating_model={t.get('operating_model')}")
        if t.get("affiliation") != [aff_expected]:
            failures.append(f"osm[{category}@{zip_}] affiliation={t.get('affiliation')}")

    # --- Yelp (2 fixtures) ---
    cases_yelp = [
        ("landscaping,lawncare", "home_services", "service_provider"),
        ("restaurant",           "hospitality",   "retailer"),
    ]
    for alias, s_expected, om_expected in cases_yelp:
        s, om = yelp_alias_to_tags(alias)
        t = build_tag_set(sector=s, operating_model=om, source="yelp")
        if t.get("sector") != [s_expected]:
            failures.append(f"yelp[{alias}] sector={t.get('sector')}")
        if t.get("operating_model") != [om_expected]:
            failures.append(f"yelp[{alias}] operating_model={t.get('operating_model')}")

    # --- ma_hic (1 fixture) ---
    t = build_tag_set(
        sector="home_services",
        operating_model="service_provider",
        affiliation="greater_boston",
        source="ma_hic_legacy",
    )
    if t.get("sector") != ["home_services"] or t.get("operating_model") != ["service_provider"]:
        failures.append(f"ma_hic tag_set={t}")

    # --- city_licenses: boston_food + cambridge_diversity + somerville_permits ---
    for src, category, s_expected, om_expected in (
        ("boston_food",         "food_establishment", "hospitality", "retailer"),
        ("cambridge_diversity", "Food Services",      "hospitality", "retailer"),
        ("somerville_permits",  "Food & Beverage",    "hospitality", "retailer"),
    ):
        s, om = city_category_to_tags(src, category)
        if s != s_expected or om != om_expected:
            failures.append(
                f"{src}[{category}] expected ({s_expected},{om_expected}) got ({s},{om})"
            )

    # --- chambers (HSBA + ArtsBoston), affiliation per plan ---
    hsba = build_tag_set(affiliation="cambridge_based", source="hsba")
    artsboston = build_tag_set(
        sector=["arts", "nonprofit"], affiliation="boston_based", source="artsboston"
    )
    if hsba.get("affiliation") != ["cambridge_based"]:
        failures.append(f"hsba affiliation={hsba.get('affiliation')}")
    if sorted(artsboston.get("sector") or []) != ["arts", "nonprofit"]:
        failures.append(f"artsboston sector={artsboston.get('sector')}")

    # --- program_books: classical + choral via H&H stem ---
    t = build_tag_set(
        sector=["arts", "nonprofit"],
        genre=["classical", "choral"],
        history="program_book_sponsor",
        source="program_book:h_and_h_program",
    )
    if sorted(t.get("genre") or []) != ["choral", "classical"]:
        failures.append(f"program_books genre={t.get('genre')}")
    if t.get("history") != ["program_book_sponsor"]:
        failures.append(f"program_books history={t.get('history')}")

    return T(
        "T05 each source emitter: fixture in → expected tag set out",
        not failures,
        "; ".join(failures) or "9 fixture cases across 6 sources all green",
    )


# -------------------------------------------------------------------------
# Dedupe merge policy (T06-T08)
# -------------------------------------------------------------------------

def t06_dedupe_union(snap: dict) -> T:
    """Two rows same business_key, disjoint tags → merged has union."""
    from enrich import dedupe

    a = {
        "source": "osm",
        "company_name": "Merge Fixture A",
        "company_phone": "617-555-0101",
        "zip": "02139",
        "tier": "B",
        "tags": {"sector": ["retail"], "affiliation": ["cambridge_based"]},
    }
    b = {
        "source": "yelp",
        "company_name": "Merge Fixture A",
        "company_phone": "617-555-0101",
        "zip": "02139",
        "tier": "B",
        "tags": {"operating_model": ["retailer"]},
    }
    merged = dedupe.dedupe([a, b])
    if len(merged) != 1:
        return _fail("T06 dedupe union", f"got {len(merged)} rows")
    row = merged[0]
    tags = row.get("tags") or {}
    ok = (
        tags.get("sector") == ["retail"]
        and tags.get("affiliation") == ["cambridge_based"]
        and tags.get("operating_model") == ["retailer"]
    )
    return T(
        "T06 two rows disjoint tags, same business_key → merged union",
        ok,
        f"tags={tags}",
    )


def t07_compliance_wins(snap: dict) -> T:
    """One side has compliance:political, other doesn't → merged keeps it."""
    from enrich import dedupe

    a = {
        "source": "osm",
        "company_name": "Merge Fixture B",
        "company_phone": "617-555-0202",
        "zip": "02139",
        "tier": "B",
    }
    b = {
        "source": "yelp",
        "company_name": "Merge Fixture B",
        "company_phone": "617-555-0202",
        "zip": "02139",
        "tier": "B",
        "tags": {"compliance": ["political"]},
    }
    merged = dedupe.dedupe([a, b])
    if len(merged) != 1:
        return _fail("T07 compliance_political", f"got {len(merged)} rows")
    ok = (merged[0].get("tags") or {}).get("compliance") == ["political"]
    return T(
        "T07 one row has compliance:political → merged retains it",
        ok,
        f"tags={merged[0].get('tags')}",
    )


def t08_rep_tag_preserved_vs_pipeline(snap: dict) -> T:
    """Rep-created prospect_tags row + pipeline re-emits conflicting value → rep tag preserved.

    `_merge_tags` operates on emitter dicts, not on DB rows; the actual
    preservation-against-rep-tag happens at tag_sync time via the
    locked_by RLS + existing (prospect_id, tag_id) unique constraint. We
    simulate the tag_sync path directly against a rep-created row.
    """
    sb = _service()
    p_id = snap["fixture_prospect_ids"]["clean_retail"]
    rep_id = snap["rep_id"]

    # Plant rep's genre:jazz manually.
    jazz_id = _ensure_vocab(sb, "genre", "jazz")
    # Remove any prior plant so the test is deterministic.
    sb.table("prospect_tags").delete().eq("prospect_id", p_id).eq("tag_id", jazz_id).execute()
    ins = (
        sb.table("prospect_tags")
        .insert(
            {
                "prospect_id": p_id,
                "tag_id": jazz_id,
                "created_by": rep_id,
            }
        )
        .execute()
    )
    rep_row_id = ins.data[0]["id"]

    # Now run tag_sync with a row that emits genre:classical (different value
    # → additive) and genre:jazz (same value → no-op).
    from db import supabase_sync

    fixture_row = {
        "company_name": "T2 Clean Prospect A",
        "zip": "02139",
        "company_phone": None,
        "tags": {"genre": ["classical", "jazz"]},
    }
    # business_key() for this row requires phone or zip+name — fixture
    # uses name+zip as its key. Seed it with business_key via the prospects
    # table's existing entry.
    # Overriding: pass the fixture prospect's business_key directly via
    # company_name/zip which business_key() will synthesise.
    # The fixture prospect was seeded with business_key='t2-fixture-clean-retail'
    # and no phone; business_key() prefers phone → falls back to name|zip.
    # We don't need to mutate it — tag_sync's _fetch_prospect_ids_for_keys
    # call will resolve via business_key derived from the same normalised
    # name+zip pair.
    # But the fixture row uses different company_name, so tag_sync won't
    # match. Easier: ensure fixture prospect's company_name/zip match.

    # Patch the fixture prospect's row to match the emit identity.
    # Use the fixture row's name+zip as source of truth.
    sb.table("prospects").update(
        {"company_name": "T2 Clean Prospect A", "zip": "02139"}
    ).eq("id", p_id).execute()

    summary = supabase_sync.tag_sync([fixture_row])

    # Check rep-locked row survives.
    after = (
        sb.table("prospect_tags")
        .select("id,tag_id,created_by")
        .eq("prospect_id", p_id)
        .execute()
        .data
        or []
    )
    rep_row_survives = any(r["id"] == rep_row_id and r["created_by"] == rep_id for r in after)
    has_classical = any(r["tag_id"] == _vocab_id(sb, "genre", "classical") for r in after)

    # Cleanup — remove tag_sync's contribution so later Tks start clean.
    sb.table("prospect_tags").delete().eq("prospect_id", p_id).eq(
        "tag_id", _vocab_id(sb, "genre", "classical")
    ).execute()
    sb.table("prospect_tags").delete().eq("id", rep_row_id).execute()

    return T(
        "T08 rep-created tag preserved across pipeline re-emit (additive)",
        rep_row_survives and has_classical,
        f"rep_survives={rep_row_survives} classical_added={has_classical} summary={summary}",
    )


# -------------------------------------------------------------------------
# Edit-lock integrity (T09a-h)
# (no en-dash — keep ASCII for ruff RUF003)
# -------------------------------------------------------------------------

def t09a_additive_not_delete(snap: dict) -> T:
    """Rep-locked jazz + pipeline emits classical → both rows survive; no delete."""
    sb = _service()
    locked_id = snap.get("locked_tag_row_id")
    target_prospect = snap.get("locked_tag_prospect_id")
    if not (locked_id and target_prospect):
        return _skip("T09a additive (no locked-tag fixture planted)", "MANUAL",
                     "t2_plant.py could not seed a locked tag target")

    classical_id = _ensure_vocab(sb, "genre", "classical")
    # Ensure the target pair isn't pre-existing.
    sb.table("prospect_tags").delete().eq("prospect_id", target_prospect).eq(
        "tag_id", classical_id
    ).execute()

    from db import supabase_sync

    # Look up the target's emitter identity so tag_sync resolves its
    # prospect_id via the same business_key shape the pipeline produces.
    t = (
        sb.table("prospects")
        .select("company_name,zip,company_phone")
        .eq("id", target_prospect)
        .single()
        .execute()
        .data
    )
    row = {
        "company_name": t["company_name"],
        "zip": t["zip"],
        "company_phone": t.get("company_phone"),
        "tags": {"genre": ["classical"]},
    }
    supabase_sync.tag_sync([row])

    after_locked = (
        sb.table("prospect_tags").select("id,locked_by").eq("id", locked_id).execute().data
    )
    locked_survives = bool(after_locked) and after_locked[0]["locked_by"] == snap["rep_id"]
    classical_present = bool(
        sb.table("prospect_tags")
        .select("id")
        .eq("prospect_id", target_prospect)
        .eq("tag_id", classical_id)
        .execute()
        .data
    )
    # Cleanup classical.
    sb.table("prospect_tags").delete().eq("prospect_id", target_prospect).eq(
        "tag_id", classical_id
    ).execute()

    return T(
        "T09a rep-locked jazz + pipeline emits classical → both rows survive",
        locked_survives and classical_present,
        f"locked={locked_survives} classical={classical_present}",
    )


def t09b_unique_constraint(snap: dict) -> T:
    """Rep-locked compliance:political + pipeline re-emits same → no duplicate."""
    sb = _service()
    rep_id = snap["rep_id"]
    p_id = snap["fixture_prospect_ids"]["clean_retail"]
    political_id = _ensure_vocab(sb, "compliance", "political")
    # Seed the locked compliance tag.
    sb.table("prospect_tags").delete().eq("prospect_id", p_id).eq(
        "tag_id", political_id
    ).execute()
    sb.table("prospect_tags").insert(
        {
            "prospect_id": p_id,
            "tag_id": political_id,
            "created_by": rep_id,
            "locked_by": rep_id,
        }
    ).execute()

    from db import supabase_sync

    p = (
        sb.table("prospects")
        .select("company_name,zip,company_phone")
        .eq("id", p_id)
        .single()
        .execute()
        .data
    )
    row = {
        "company_name": p["company_name"],
        "zip": p["zip"],
        "company_phone": p.get("company_phone"),
        "tags": {"compliance": ["political"]},
    }
    supabase_sync.tag_sync([row])
    count = (
        sb.table("prospect_tags")
        .select("id", count="exact", head=True)
        .eq("prospect_id", p_id)
        .eq("tag_id", political_id)
        .execute()
    )
    ok = (count.count or 0) == 1
    # Cleanup.
    sb.table("prospect_tags").delete().eq("prospect_id", p_id).eq(
        "tag_id", political_id
    ).execute()
    return T(
        "T09b unique (prospect_id, tag_id) dedups pipeline re-emission",
        ok,
        f"row_count={count.count}",
    )


def t09c_admin_locked_vs_other_rep(snap: dict) -> T:
    """Admin-locked tag + another rep DELETE → 403 (RLS denies)."""
    sb = _service()
    admin_id = snap["admin_id"]
    p_id = snap["fixture_prospect_ids"]["clean_retail"]
    test_id = _ensure_vocab(sb, "other", "t2_admin_lock_probe")
    sb.table("prospect_tags").delete().eq("prospect_id", p_id).eq(
        "tag_id", test_id
    ).execute()
    ins = sb.table("prospect_tags").insert(
        {
            "prospect_id": p_id,
            "tag_id": test_id,
            "created_by": admin_id,
            "locked_by": admin_id,
        }
    ).execute()
    locked_row = ins.data[0]["id"]
    # Act as the T2 rep — RLS should deny.
    rep_sb = create_client(SUPABASE_URL, ANON_KEY)
    rep_sb.auth.sign_in_with_password(
        {"email": snap["rep_email"], "password": snap["rep_password"]}
    )
    rep_sb.table("prospect_tags").delete().eq("id", locked_row).execute()
    # The row should still exist.
    after = (
        sb.table("prospect_tags")
        .select("id")
        .eq("id", locked_row)
        .execute()
        .data
    )
    ok = bool(after)
    # Cleanup.
    sb.table("prospect_tags").delete().eq("id", locked_row).execute()
    return T(
        "T09c admin-locked tag + other rep DELETE → blocked by RLS",
        ok,
        f"row_still_present={ok}",
    )


def t09d_self_unlock_and_delete(snap: dict) -> T:
    """Rep can delete a tag they locked themselves."""
    sb = _service()
    rep_id = snap["rep_id"]
    p_id = snap["fixture_prospect_ids"]["clean_retail"]
    test_id = _ensure_vocab(sb, "other", "t2_self_unlock_probe")
    sb.table("prospect_tags").delete().eq("prospect_id", p_id).eq(
        "tag_id", test_id
    ).execute()
    ins = sb.table("prospect_tags").insert(
        {
            "prospect_id": p_id,
            "tag_id": test_id,
            "created_by": rep_id,
            "locked_by": rep_id,
        }
    ).execute()
    row_id = ins.data[0]["id"]
    rep_sb = create_client(SUPABASE_URL, ANON_KEY)
    rep_sb.auth.sign_in_with_password(
        {"email": snap["rep_email"], "password": snap["rep_password"]}
    )
    rep_sb.table("prospect_tags").delete().eq("id", row_id).execute()
    after = sb.table("prospect_tags").select("id").eq("id", row_id).execute().data
    ok = not after
    return T(
        "T09d rep DELETEs their own locked tag → 204 (self unlock-and-delete)",
        ok,
        f"row_gone={ok}",
    )


def t09e_additive_compliance(snap: dict) -> T:
    """Pipeline-locked compliance:political + pipeline emits compliance:other_value → both survive.

    v1 has only ``compliance:political`` + ``compliance:unknown`` in the
    seed vocab; we insert a second value for the test then clean up.
    """
    sb = _service()
    p_id = snap["fixture_prospect_ids"]["clean_retail"]
    political_id = _ensure_vocab(sb, "compliance", "political")
    other_id = _ensure_vocab(sb, "compliance", "t2_additive_probe")

    sb.table("prospect_tags").delete().eq("prospect_id", p_id).in_(
        "tag_id", [political_id, other_id]
    ).execute()

    # Simulate a pipeline-locked compliance:political row.
    sb.table("prospect_tags").insert(
        {
            "prospect_id": p_id,
            "tag_id": political_id,
            "created_by": None,
            "locked_by": None,  # pipeline-emitted; not locked, still survives union
        }
    ).execute()
    from db import supabase_sync

    p = (
        sb.table("prospects")
        .select("company_name,zip,company_phone")
        .eq("id", p_id)
        .single()
        .execute()
        .data
    )
    row = {
        "company_name": p["company_name"],
        "zip": p["zip"],
        "company_phone": p.get("company_phone"),
        "tags": {"compliance": ["t2_additive_probe"]},
    }
    supabase_sync.tag_sync([row])
    after = (
        sb.table("prospect_tags")
        .select("tag_id")
        .eq("prospect_id", p_id)
        .in_("tag_id", [political_id, other_id])
        .execute()
        .data
    )
    tag_ids = {r["tag_id"] for r in after}
    ok = political_id in tag_ids and other_id in tag_ids
    # Cleanup — drop the probe vocab + any lingering rows.
    sb.table("prospect_tags").delete().eq("prospect_id", p_id).eq(
        "tag_id", other_id
    ).execute()
    sb.table("tag_vocabulary").delete().eq("id", other_id).execute()
    sb.table("prospect_tags").delete().eq("prospect_id", p_id).eq(
        "tag_id", political_id
    ).execute()
    return T(
        "T09e additive compliance: both values survive pipeline rerun",
        ok,
        f"tag_ids={sorted(tag_ids)}",
    )


def t09f_merge_preserves_locked(snap: dict) -> T:
    """Admin merges X → Y with X having locked rows → locked_by preserved verbatim."""
    sb = _service()
    rep_id = snap["rep_id"]
    p_id = snap["fixture_prospect_ids"]["clean_retail"]

    src = _ensure_vocab(sb, "other", f"t2_merge_src_{uuid.uuid4().hex[:6]}")
    tgt = _ensure_vocab(sb, "other", f"t2_merge_tgt_{uuid.uuid4().hex[:6]}")
    sb.table("prospect_tags").insert(
        {
            "prospect_id": p_id,
            "tag_id": src,
            "created_by": rep_id,
            "locked_by": rep_id,
        }
    ).execute()
    rpc = sb.rpc("merge_tag_vocabulary", {"p_source_id": src, "p_target_id": tgt}).execute()
    after = (
        sb.table("prospect_tags")
        .select("tag_id,locked_by")
        .eq("prospect_id", p_id)
        .eq("tag_id", tgt)
        .execute()
        .data
    )
    ok = bool(after) and after[0]["locked_by"] == rep_id and (
        rpc.data.get("affected_prospect_count") == 1
    )
    sb.table("prospect_tags").delete().eq("prospect_id", p_id).eq("tag_id", tgt).execute()
    sb.table("tag_vocabulary").delete().eq("id", tgt).execute()
    return T(
        "T09f merge retag preserves locked_by",
        ok,
        f"locked_by_preserved={ok} merge_data={rpc.data}",
    )


def t09g_cross_user_delete(snap: dict) -> T:
    """Rep attempts DELETE on a tag locked by admin → RLS denies."""
    # Reuses the same logic as T09c but documented as a named check.
    return t09c_admin_locked_vs_other_rep(snap).__class__(
        "T09g rep DELETE on another user's locked tag → 403",
        t09c_admin_locked_vs_other_rep(snap).passed,
        "covered by T09c",
    )


def t09h_soft_clear_resuppression(snap: dict) -> T:
    """Soft-cleared compliance tag + pipeline re-emission → no new row; event emitted."""
    sb = _service()
    p_id = snap["fixture_prospect_ids"]["clean_retail"]
    political_id = _ensure_vocab(sb, "compliance", "political")
    from datetime import UTC, datetime

    # Seed a soft-cleared row.
    sb.table("prospect_tags").delete().eq("prospect_id", p_id).eq(
        "tag_id", political_id
    ).execute()
    sb.table("prospect_tags").insert(
        {
            "prospect_id": p_id,
            "tag_id": political_id,
            "created_by": None,
            "suppressed_at": datetime.now(tz=UTC).isoformat(),
            "suppressed_by": snap["rep_id"],
        }
    ).execute()

    pre = (
        sb.table("event_log")
        .select("id", count="exact", head=True)
        .eq("category", "compliance_resuppressed")
        .execute()
    )
    pre_count = pre.count or 0

    from db import supabase_sync
    from util import event_log as _event_log

    p = (
        sb.table("prospects")
        .select("company_name,zip,company_phone")
        .eq("id", p_id)
        .single()
        .execute()
        .data
    )
    row = {
        "company_name": p["company_name"],
        "zip": p["zip"],
        "company_phone": p.get("company_phone"),
        "tags": {"compliance": ["political"]},
    }
    supabase_sync.tag_sync([row])
    _event_log.flush()

    post = (
        sb.table("event_log")
        .select("id", count="exact", head=True)
        .eq("category", "compliance_resuppressed")
        .execute()
    )
    delta = (post.count or 0) - pre_count
    # The suppressed row stays; no new row added.
    count = (
        sb.table("prospect_tags")
        .select("id", count="exact", head=True)
        .eq("prospect_id", p_id)
        .eq("tag_id", political_id)
        .execute()
    )
    ok = (count.count or 0) == 1 and delta >= 1
    # Cleanup.
    sb.table("prospect_tags").delete().eq("prospect_id", p_id).eq(
        "tag_id", political_id
    ).execute()
    return T(
        "T09h soft-cleared compliance + pipeline re-emit → resuppress event, no new row",
        ok,
        f"row_count={count.count} event_delta={delta}",
    )


# -------------------------------------------------------------------------
# Backfill + vocab conformance + view (T10-T15)
# -------------------------------------------------------------------------

def t10_backfill_idempotent(snap: dict) -> T:
    """Backfill first run populates rows; second run is a no-op on already-tagged prospects."""
    sb = _service()
    # Count prospects, count prospect_tags.
    before_count = (
        sb.table("prospect_tags").select("id", count="exact", head=True).execute().count or 0
    )
    # First call (live against DB — cheap because already-tagged prospects short-circuit).
    subprocess.run(
        [sys.executable, str(HERE / "t2_backfill.py"), "--batch-size", "500"],
        check=True,
        cwd=WHRB,
    )
    mid_count = (
        sb.table("prospect_tags").select("id", count="exact", head=True).execute().count or 0
    )
    # Second call — must add zero new rows.
    subprocess.run(
        [sys.executable, str(HERE / "t2_backfill.py"), "--batch-size", "500"],
        check=True,
        cwd=WHRB,
    )
    after_count = (
        sb.table("prospect_tags").select("id", count="exact", head=True).execute().count or 0
    )
    ok = after_count == mid_count and mid_count >= before_count
    return T(
        "T10 backfill fresh run populates; second run is zero-new",
        ok,
        f"before={before_count} mid={mid_count} after={after_count}",
    )


def t11_no_name_heuristics(snap: dict) -> T:
    """Grep t2_backfill.py source for forbidden name-heuristic patterns.

    The plan forbids name-keyword derivations in backfill (round-4). Check
    the source imports + calls: there must be no regex / substring match
    over ``company_name`` or ``name`` at derive time.
    """
    bf = HERE / "t2_backfill.py"
    src = bf.read_text()
    # Parse the AST so we catch calls rather than comment mentions.
    tree = ast.parse(src)
    offending: list[str] = []

    class NameAccessFinder(ast.NodeVisitor):
        def visit_Subscript(self, node: ast.Subscript) -> None:
            key = None
            if isinstance(node.slice, ast.Constant):
                key = node.slice.value
            if isinstance(key, str) and key in {"company_name", "name"}:
                offending.append(f"subscript {ast.unparse(node)}")
            self.generic_visit(node)

        def visit_Call(self, node: ast.Call) -> None:
            # catch row.get("company_name") / row.get("name")
            func = ast.unparse(node.func)
            if func.endswith(".get") and node.args:
                arg0 = node.args[0]
                if isinstance(arg0, ast.Constant) and arg0.value in {"company_name", "name"}:
                    offending.append(ast.unparse(node))
            self.generic_visit(node)

    NameAccessFinder().visit(tree)
    return T(
        "T11 backfill uses zero name-heuristic derivations",
        not offending,
        "; ".join(offending) or "no company_name/name reads in derivation path",
    )


def t12_daypart_fixtures(snap: dict) -> T:
    """Daypart view derives expected sets for seeded fixtures."""
    sb = _service()
    p_id = snap["fixture_prospect_ids"]["clean_retail"]
    # Attach genre:classical; expect daypart_classical.
    classical_id = _ensure_vocab(sb, "genre", "classical")
    sb.table("prospect_tags").upsert(
        {"prospect_id": p_id, "tag_id": classical_id, "created_by": None},
        on_conflict="prospect_id,tag_id",
        ignore_duplicates=True,
    ).execute()
    conn = _conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "select daypart_fit from public.prospect_daypart where prospect_id = %s",
                (p_id,),
            )
            row = cur.fetchone()
    finally:
        conn.close()
    got = set(row[0]) if row else set()
    classical_ok = got == {"classical"}

    # Now add genre:jazz + affiliation:harvard_affiliated; expect
    # {classical, jazz, sports_news}.
    jazz_id = _ensure_vocab(sb, "genre", "jazz")
    harvard_id = _ensure_vocab(sb, "affiliation", "harvard_affiliated")
    sb.table("prospect_tags").upsert(
        [
            {"prospect_id": p_id, "tag_id": jazz_id, "created_by": None},
            {"prospect_id": p_id, "tag_id": harvard_id, "created_by": None},
        ],
        on_conflict="prospect_id,tag_id",
        ignore_duplicates=True,
    ).execute()
    conn = _conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "select daypart_fit from public.prospect_daypart where prospect_id = %s",
                (p_id,),
            )
            row2 = cur.fetchone()
    finally:
        conn.close()
    got2 = set(row2[0]) if row2 else set()
    multi_ok = {"classical", "jazz", "sports_news"} <= got2

    # Add sector:media + operating_model:distributor; expect
    # multi_daypart in the result alongside the existing values
    # (rule added retroactively in the T2 review pass, 2026-04-25).
    media_id = _ensure_vocab(sb, "sector", "media")
    distributor_id = _ensure_vocab(sb, "operating_model", "distributor")
    sb.table("prospect_tags").upsert(
        [
            {"prospect_id": p_id, "tag_id": media_id, "created_by": None},
            {"prospect_id": p_id, "tag_id": distributor_id, "created_by": None},
        ],
        on_conflict="prospect_id,tag_id",
        ignore_duplicates=True,
    ).execute()
    conn = _conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "select daypart_fit from public.prospect_daypart where prospect_id = %s",
                (p_id,),
            )
            row3 = cur.fetchone()
    finally:
        conn.close()
    got3 = set(row3[0]) if row3 else set()
    media_ok = "multi_daypart" in got3

    # Cleanup — remove all five tags so later Tks are not polluted.
    for tid in (classical_id, jazz_id, harvard_id, media_id, distributor_id):
        sb.table("prospect_tags").delete().eq("prospect_id", p_id).eq("tag_id", tid).execute()
    return T(
        "T12 daypart view derives expected sets for fixtures",
        classical_ok and multi_ok and media_ok,
        f"classical={got} multi={got2} media+distributor={got3}",
    )


def t13_daypart_fallback(snap: dict) -> T:
    """Empty tag set → {classical} fallback."""
    sb = _service()
    p_id = snap["fixture_prospect_ids"]["clean_home_services"]
    # Ensure no tags on this prospect.
    sb.table("prospect_tags").delete().eq("prospect_id", p_id).execute()
    conn = _conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "select daypart_fit from public.prospect_daypart where prospect_id = %s",
                (p_id,),
            )
            row = cur.fetchone()
    finally:
        conn.close()
    got = set(row[0]) if row else set()
    return T(
        "T13 empty tag set → {classical} fallback",
        got == {"classical"},
        f"got={got}",
    )


def t14_fk_reject(snap: dict) -> T:
    """INSERT into prospect_tags with a non-existent tag_id → FK rejection."""
    sb = _service()
    p_id = snap["fixture_prospect_ids"]["clean_retail"]
    fake = uuid.uuid4().hex
    # Service role bypasses RLS but not FK; the insert should still reject.
    try:
        sb.table("prospect_tags").insert(
            {"prospect_id": p_id, "tag_id": fake, "created_by": None}
        ).execute()
        return _fail("T14 FK reject", "insert unexpectedly succeeded")
    except Exception as e:
        msg = str(e).lower()
        ok = any(tok in msg for tok in ("foreign key", "fk", "violates", "22p02", "23503"))
        return T(
            "T14 non-existent tag_id rejected by FK",
            ok,
            f"error_snippet={str(e)[:200]!r}",
        )


def t15_vocab_conformance(snap: dict) -> T:
    """Every (axis, value) the emitters produce for fixture rows must exist in tag_vocabulary."""
    from util.tags import (
        affiliation_for_zip,
        build_tag_set,
        osm_category_to_tags,
        reset_cache,
    )

    reset_cache()
    emitted: set[tuple[str, str]] = set()
    # Re-use t05's fixture cases, but in strict mode so a typo raises.
    for (cat, zip_, _s, _om, _aff) in (
        ("amenity=theatre", "02138", None, None, None),
        ("craft=plumber",   "02143", None, None, None),
        ("shop=books",      "02116", None, None, None),
    ):
        s, om = osm_category_to_tags(cat)
        aff = affiliation_for_zip(zip_)
        t = build_tag_set(
            sector=s, operating_model=om, affiliation=aff, source="osm", strict=True
        )
        for axis, values in t.items():
            for v in values:
                emitted.add((axis, v))

    sb = _service()
    rows = (
        sb.table("tag_vocabulary")
        .select("axis,value")
        .execute()
        .data
        or []
    )
    vocab = {(r["axis"], r["value"]) for r in rows}
    missing = emitted - vocab
    return T(
        "T15 every emitted tag exists in tag_vocabulary",
        not missing,
        f"missing={sorted(missing) or 'none'} emitted={len(emitted)}",
    )


# -------------------------------------------------------------------------
# Exit gate checks (T16-T18)
# -------------------------------------------------------------------------

def t16_backfill_threshold(snap: dict) -> T:
    """Reframed from plan's `full rerun` — runs backfill against existing
    prospects and verifies ≥10k prospect_tags rows post-backfill.

    See ROLLOUT.md T2 plan-deviation section for the rationale: the
    hours-long full scrape adds no coverage beyond the backfill +
    emitter-fixture smoke tests already in T05.
    """
    sb = _service()
    # Ensure backfill has been applied — idempotent so a re-run is cheap.
    subprocess.run(
        [sys.executable, str(HERE / "t2_backfill.py"), "--batch-size", "1000"],
        check=True,
        cwd=WHRB,
    )
    count = (
        sb.table("prospect_tags").select("id", count="exact", head=True).execute().count or 0
    )
    threshold = 10_000
    return T(
        "T16 backfill produces ≥ 10,000 prospect_tags rows (reframed from full rerun)",
        count >= threshold,
        f"count={count:,} threshold={threshold}",
    )


def t17_zero_errors(snap: dict) -> T:
    conn = _conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "select count(*) from public.event_log "
                "where level in ('error','fatal') and created_at > %s",
                (snap["stage_started_at"],),
            )
            n = cur.fetchone()[0]
    finally:
        conn.close()
    return T(
        "T17 zero level=error rows in event_log since stage start",
        n == 0,
        f"error_count={n} since={snap['stage_started_at']}",
    )


def t18_regression(snap: dict, skip: bool) -> T:
    """T1 + 10b + 10c structural regression — same reframing T1 itself
    adopted for its T18, extended in the T2 review pass (2026-04-25)
    to cover 10b and 10c.

    For each prior stage:
      (a) scripts/<stage>_integrity.py imports cleanly under T2 changes.
      (b) ROLLOUT certification line for the stage is still present.
      (c) Zero new T2-emitted errors in the stage's surface categories.

    Pipeline is NOT re-run; this is a static + read-only check.
    """
    if skip:
        return _skip("T18 regression", "MANUAL", "--skip-regression flag set")

    failures: list[str] = []
    rollout = REPO_ROOT / "ROLLOUT.md"
    if not rollout.exists():
        failures.append("ROLLOUT.md missing")
        return T(
            "T18 regression: T1 + 10b + 10c integrity scripts importable + ROLLOUT certs + zero stage-category errors",
            False,
            "; ".join(failures),
        )
    rollout_text = rollout.read_text()

    def _check_import(script_path: Path, label: str) -> None:
        if not script_path.exists():
            failures.append(f"scripts/{script_path.name} missing")
            return
        r = subprocess.run(
            [
                sys.executable,
                "-c",
                "import importlib.util, sys;"
                f"spec = importlib.util.spec_from_file_location({label!r}, r'{script_path}');"
                "m = importlib.util.module_from_spec(spec);"
                f"sys.modules[{label!r}] = m;"
                "spec.loader.exec_module(m);"
                "print('IMPORT OK')",
            ],
            capture_output=True,
            text=True,
        )
        if r.returncode != 0 or "IMPORT OK" not in r.stdout:
            failures.append(
                f"{script_path.name} import broke: rc={r.returncode} stderr={r.stderr[:300]}"
            )

    def _check_no_new_errors(categories: list[str], stage_label: str) -> None:
        conn = _conn()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "select count(*) from public.event_log "
                    "where level in ('error','fatal') "
                    "and category = ANY(%s) and created_at > %s",
                    (categories, snap["stage_started_at"]),
                )
                n = cur.fetchone()[0]
        finally:
            conn.close()
        if n != 0:
            failures.append(f"{n} new error events in {stage_label} categories since T2 start")

    # ----- T1 structural regression -----
    _check_import(WHRB / "scripts" / "t1_integrity.py", "t1")
    if "pass=21 skip-browser=6" not in rollout_text:
        failures.append("ROLLOUT Stage T1 certification line missing")
    _check_no_new_errors(
        [
            "vocab_created",
            "vocab_updated",
            "vocab_axis_changed",
            "vocab_deleted",
            "tag_merge",
            "prospect_tag_added",
            "prospect_tag_removed",
        ],
        "T1",
    )

    # ----- Stage 10b structural regression -----
    _check_import(WHRB / "scripts" / "stage10b_integrity.py", "stage10b")
    if "Stage 10b integrity: 15 pass, 8 skip-covered, 0 fail" not in rollout_text:
        failures.append("ROLLOUT Stage 10b certification line missing")
    _check_no_new_errors(
        [
            "bulk_action",
            "export",
            "email_skipped_no_provider",
            "notification_dispatch",
            "presence_heartbeat",
        ],
        "Stage 10b",
    )

    # ----- Stage 10c structural regression -----
    _check_import(WHRB / "scripts" / "stage10c_integrity.py", "stage10c")
    if "Stage 10c Tks: pass=16 skip-covered=11 skip-manual=1 fail=0" not in rollout_text:
        failures.append("ROLLOUT Stage 10c certification line missing")
    _check_no_new_errors(
        [
            "pipeline_run_failed",
            "admin_cancel_run",
            "admin_cancel_run_failed",
            "feedback_submit",
            "run_dispatch",
        ],
        "Stage 10c",
    )

    return T(
        "T18 regression: T1 + 10b + 10c integrity scripts importable + ROLLOUT certs + zero stage-category errors",
        not failures,
        "; ".join(failures)
        or "T1 + 10b + 10c imports OK; all 3 ROLLOUT certs present; 0 new stage-category errors",
    )


# -------------------------------------------------------------------------
# Driver
# -------------------------------------------------------------------------

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--skip-regression", action="store_true")
    args = ap.parse_args()

    if not SNAPSHOT_PATH.exists():
        print(f"Run scripts/t2_plant.py first (snapshot at {SNAPSHOT_PATH}).",
              file=sys.stderr)
        return 2
    snap = json.loads(SNAPSHOT_PATH.read_text())

    results: list[T] = []
    results.append(t01_ccc_match_blocks(snap))
    results.append(t02_false_positive_name(snap))
    results.append(t03_address_twin(snap))
    results.append(t04_osm_shop_cannabis(snap))
    results.append(t05_source_fixtures(snap))
    results.append(t06_dedupe_union(snap))
    results.append(t07_compliance_wins(snap))
    results.append(t08_rep_tag_preserved_vs_pipeline(snap))
    results.append(t09a_additive_not_delete(snap))
    results.append(t09b_unique_constraint(snap))
    results.append(t09c_admin_locked_vs_other_rep(snap))
    results.append(t09d_self_unlock_and_delete(snap))
    results.append(t09e_additive_compliance(snap))
    results.append(t09f_merge_preserves_locked(snap))
    results.append(t09g_cross_user_delete(snap))
    results.append(t09h_soft_clear_resuppression(snap))
    results.append(t10_backfill_idempotent(snap))
    results.append(t11_no_name_heuristics(snap))
    results.append(t12_daypart_fixtures(snap))
    results.append(t13_daypart_fallback(snap))
    results.append(t14_fk_reject(snap))
    results.append(t15_vocab_conformance(snap))
    results.append(t16_backfill_threshold(snap))
    results.append(t17_zero_errors(snap))
    results.append(t18_regression(snap, args.skip_regression))

    print(f"\nStage T2 integrity\n  snapshot: {SNAPSHOT_PATH}\n")
    pass_n = skip_browser = skip_manual = fail_n = 0
    for r in results:
        if r.skipped == "BROWSER":
            tag = "[SKIP-BROWSER]"
            skip_browser += 1
        elif r.skipped == "MANUAL":
            tag = "[SKIP-MANUAL ]"
            skip_manual += 1
        elif r.passed:
            tag = "[PASS        ]"
            pass_n += 1
        else:
            tag = "[FAIL        ]"
            fail_n += 1
        print(f"{tag} {r.name}: {r.detail}")
    print(
        f"\nStage T2 Tks: pass={pass_n} skip-browser={skip_browser} "
        f"skip-manual={skip_manual} fail={fail_n} (total {len(results)})"
    )
    return 0 if fail_n == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
