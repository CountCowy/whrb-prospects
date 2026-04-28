#!/usr/bin/env python3
"""Stage T5 plant — competitor_stations source fixtures.

Plants:
  - 1 dedupe-test prospect with company_name 'Boston Symphony Orchestra'
    (zip 02115, source='manual') so that when the live competitor_stations
    run scrapes WERS and emits a row also called 'Boston Symphony
    Orchestra', the dedupe phase merges them and the resulting row's
    `source` comma-list contains both 'manual' and 'competitor_stations'
    (T07 collision).
  - 1 dedupe-test prospect with company_name 'WBUR CitySpace' for the
    peer-suppression e2e check (T11 sub-check: peer-suppressed rows do
    NOT appear in `prospects`, even with a pre-seeded match).

Plus, ensures `requests-cache` is fresh for the 5 station URLs only by
deleting just those entries — every other source's cache survives.

Snapshot at ``cache/t5_snapshot.json``.

Idempotent: refuses to re-run while ``cache/t5_snapshot.json`` exists.
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

SNAPSHOT_PATH = WHRB / "cache" / "t5_snapshot.json"
HTTP_CACHE_PATH = WHRB / "cache" / "http_cache.sqlite"

SUPABASE_URL = os.environ["SUPABASE_URL"]
SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]


def _client():
    return create_client(SUPABASE_URL, SERVICE_KEY)


def _evict_station_urls(http_cache: Path) -> int:
    """Delete cached responses for the 5 station URLs only.

    Returns the count of evicted entries. ``requests-cache`` stores
    responses keyed by an opaque hash, so we drive the eviction via
    the library's own ``delete(urls=...)`` API rather than raw SQL.
    Other sources' cache entries are untouched.
    """
    if not http_cache.exists():
        return 0
    try:
        import requests_cache
    except ImportError:
        return 0
    targets = [
        "https://www.classicalwcrb.org/corporate-sponsorship",
        "https://sponsorship.wgbh.org/",
        "https://www.wbur.org/membership/605748/members",
        "https://wumb.org/support/",
        "https://wers.org/current-underwriters/",
        # robots.txt URLs too — we want a fresh robots check.
        "https://www.classicalwcrb.org/robots.txt",
        "https://sponsorship.wgbh.org/robots.txt",
        "https://www.wbur.org/robots.txt",
        "https://wumb.org/robots.txt",
        "https://wers.org/robots.txt",
    ]
    backend = requests_cache.SQLiteCache(db_path=str(http_cache.with_suffix("")))
    deleted = 0
    for url in targets:
        try:
            # requests-cache 1.x: backend.delete(urls=[url]) wipes any
            # cached entries for that exact URL.
            before = len(list(backend.responses))
            backend.delete(urls=[url])
            after = len(list(backend.responses))
            deleted += max(0, before - after)
        except Exception:
            # Best effort — never block plant on a cache eviction issue.
            pass
    return deleted


def main() -> int:
    if SNAPSHOT_PATH.exists():
        print(f"REFUSE: {SNAPSHOT_PATH} exists. Run t5_cleanup.py first.")
        return 1

    sb = _client()
    started = dt.datetime.now(tz=dt.UTC).isoformat()
    snapshot: dict = {
        "started": started,
        "prospects": [],
        "http_cache_evictions": 0,
    }

    # ---- 1. Dedupe-test prospect: 'Boston Symphony Orchestra' (T07).
    bso_payload = {
        "company_name": "Boston Symphony Orchestra",
        "tier": "B",
        "state": "researching",
        "created_source": "manual",
        "source": "manual",
        "category": "amenity=concert_hall",
        "zip": "02115",
        "website": "https://www.bso.org/",
        "pipeline_notes": "t5 fixture — bso dedupe collision",
    }
    bso_payload["business_key"] = compute_business_key(bso_payload)
    res = (
        sb.table("prospects")
        .upsert(bso_payload, on_conflict="business_key")
        .execute()
    )
    bso_id = (res.data or [{}])[0].get("id")
    snapshot["prospects"].append({"id": bso_id, "company_name": "Boston Symphony Orchestra"})

    # ---- 2. Peer-suppression seed: pre-existing 'WBUR CitySpace' (T11
    # sub-check). After the live run, this row should still exist (the
    # whitelist suppresses NEW rows but doesn't delete prior ones).
    cityspace_payload = {
        "company_name": "WBUR CitySpace",
        "tier": "B",
        "state": "researching",
        "created_source": "manual",
        "source": "manual",
        "zip": "02111",
        "pipeline_notes": "t5 fixture — peer suppression collision",
    }
    cityspace_payload["business_key"] = compute_business_key(cityspace_payload)
    res = (
        sb.table("prospects")
        .upsert(cityspace_payload, on_conflict="business_key")
        .execute()
    )
    cs_id = (res.data or [{}])[0].get("id")
    snapshot["prospects"].append({"id": cs_id, "company_name": "WBUR CitySpace"})

    # ---- 3. Evict cached responses for the 5 station URLs only.
    snapshot["http_cache_evictions"] = _evict_station_urls(HTTP_CACHE_PATH)

    SNAPSHOT_PATH.parent.mkdir(parents=True, exist_ok=True)
    SNAPSHOT_PATH.write_text(json.dumps(snapshot, indent=2))
    print(f"OK plant complete. snapshot={SNAPSHOT_PATH}")
    print(json.dumps(snapshot, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
