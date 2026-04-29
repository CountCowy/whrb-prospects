#!/usr/bin/env python3
"""Stage T6 plant — fetch fixture HTML for all six T6 sources.

Plan §8.7: ``t6_plant.py`` captures fresh HTML snapshots of each of
~30 pages into ``tests/fixtures/t6/<source>/<slug>.html``. The
integrity script then runs every parser against the captured fixtures.

Polite HTTP posture (matches sources/_sponsor_pages_common.py):

  * UA: ``WHRBProspectPipeline/1.0``
  * Per-host rate limit: 5s
  * 30s timeout per request
  * No JS execution; static HTML only

Plus, plants 2 dedupe-test prospects:

  1. **Boston Symphony Orchestra** at zip 02115, source='manual', so the
     dedupe collision in T07 (program_book_sponsor + corporate_sponsor_pages)
     can verify that the resulting row's ``source`` comma-list contains the
     T6 contributor.
  2. **Harvard Glee Club**, source='manual', so the T10 known-client
     spot-check has a guaranteed row to dedupe-merge against the
     ``harvard_orgs`` ensemble row.

Snapshot at ``cache/t6_snapshot.json``. Idempotent: refuses to re-run
while the snapshot exists.

Usage:
    .venv/bin/python scripts/t6_plant.py            # live-fetch
    .venv/bin/python scripts/t6_plant.py --dry-run  # no fetch, no plant
    .venv/bin/python scripts/t6_plant.py --skip-fetch  # plant only
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
import time
from pathlib import Path

import requests
from dotenv import load_dotenv
from supabase import create_client

HERE = Path(__file__).resolve().parent
WHRB = HERE.parent
sys.path.insert(0, str(WHRB))
load_dotenv(WHRB / ".env")

from db.supabase_sync import business_key as compute_business_key
from sources import (
    arts_associations,
    artsboston_calendar,
    church_concerts,
    corporate_sponsor_pages,
    harvard_orgs,
    music_school_departments,
)
from sources._sponsor_pages_common import (
    HTTP_TIMEOUT_SECONDS,
    RATE_LIMIT_SECONDS,
    USER_AGENT,
    per_host_sleep,
)

SUPABASE_URL = os.environ["SUPABASE_URL"]
SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

SNAPSHOT_PATH = WHRB / "cache" / "t6_snapshot.json"
FIXTURE_ROOT = WHRB / "tests" / "fixtures" / "t6"

# Manifests describing each (source_key, slug, url) the plant will fetch.
# Mirrors the per-source configuration tables in the source modules.
_FETCH_MANIFEST: list[tuple[str, str, str]] = []

# harvard_orgs — 6 feeds.
for slug, feed in harvard_orgs._FEEDS.items():
    _FETCH_MANIFEST.append((harvard_orgs.SOURCE_KEY, slug, feed["url"]))

# arts_associations — 4 feeds.
for slug, feed in arts_associations._FEEDS.items():
    _FETCH_MANIFEST.append((arts_associations.SOURCE_KEY, slug, feed["url"]))

# corporate_sponsor_pages — 10 targets.
for slug, target in corporate_sponsor_pages._TARGETS.items():
    _FETCH_MANIFEST.append(
        (corporate_sponsor_pages.SOURCE_KEY, slug, target["url"])
    )

# artsboston_calendar — 1 page.
_FETCH_MANIFEST.append(
    (artsboston_calendar.SOURCE_KEY, "calendar", artsboston_calendar.CALENDAR_URL)
)

# church_concerts — 9 venues.
for slug, venue in church_concerts._VENUES.items():
    _FETCH_MANIFEST.append((church_concerts.SOURCE_KEY, slug, venue["url"]))

# music_school_departments — 8 institutions.
for slug, inst in music_school_departments._INSTITUTIONS.items():
    _FETCH_MANIFEST.append(
        (music_school_departments.SOURCE_KEY, slug, inst["url"])
    )


def _client():
    return create_client(SUPABASE_URL, SERVICE_KEY)


def _fetch_one(url: str) -> tuple[int, str]:
    """Polite GET. Returns ``(status_code, body)`` or raises on transport
    failure.
    """
    per_host_sleep(url, seconds=RATE_LIMIT_SECONDS)
    r = requests.get(
        url,
        headers={"User-Agent": USER_AGENT},
        timeout=HTTP_TIMEOUT_SECONDS,
        allow_redirects=True,
    )
    return r.status_code, r.text


def _capture_fixtures(
    *, dry_run: bool, skip_fetch: bool, only_missing: bool = False
) -> list[dict]:
    """Live-fetch each manifest entry; write to tests/fixtures/t6/...

    *only_missing* limits fetches to manifest entries whose target file
    doesn't exist. Useful on re-run after a schema/manifest change adds
    new entries — preserves the previously-captured snapshots.
    """
    results: list[dict] = []
    for source_key, slug, url in _FETCH_MANIFEST:
        target_dir = FIXTURE_ROOT / source_key
        target_dir.mkdir(parents=True, exist_ok=True)
        target_file = target_dir / f"{slug}.html"
        rec: dict = {
            "source_key": source_key,
            "slug": slug,
            "url": url,
            "path": str(target_file.relative_to(WHRB)),
        }
        if skip_fetch and target_file.exists():
            rec["status"] = "skip-fetch (already exists)"
            rec["bytes"] = target_file.stat().st_size
            results.append(rec)
            print(f"  [skip-fetch] {source_key}/{slug}.html ({rec['bytes']} bytes)")
            continue
        if only_missing and target_file.exists() and target_file.stat().st_size > 0:
            rec["status"] = "only-missing-skip"
            rec["bytes"] = target_file.stat().st_size
            results.append(rec)
            print(f"  [only-missing-skip] {source_key}/{slug}.html ({rec['bytes']} bytes)")
            continue
        if dry_run:
            rec["status"] = "dry-run"
            results.append(rec)
            print(f"  [dry-run] would fetch {url}")
            continue
        try:
            status_code, body = _fetch_one(url)
            rec["status_code"] = status_code
            rec["bytes"] = len(body)
            if status_code >= 400:
                rec["status"] = "http-error"
                target_file.write_text(
                    f"<!-- T6 plant: HTTP {status_code} from {url} at "
                    f"{dt.datetime.now(tz=dt.UTC).isoformat()} -->\n"
                    "<html><body><p>fetch failed</p></body></html>",
                    encoding="utf-8",
                )
                print(
                    f"  [http {status_code}] {source_key}/{slug} ← {url} (placeholder written)"
                )
            else:
                target_file.write_text(body, encoding="utf-8")
                rec["status"] = "ok"
                print(
                    f"  [ok] {source_key}/{slug}.html ← {url} ({len(body):,} bytes)"
                )
        except Exception as exc:
            rec["status"] = "fetch-error"
            rec["error"] = f"{type(exc).__name__}: {exc}"
            target_file.write_text(
                f"<!-- T6 plant: {type(exc).__name__}: {exc} from {url} -->\n"
                "<html><body><p>fetch error</p></body></html>",
                encoding="utf-8",
            )
            print(
                f"  [error] {source_key}/{slug} ← {url}: {type(exc).__name__}"
            )
        results.append(rec)
        # Light extra spacer between fetches in addition to per_host_sleep —
        # belt-and-suspenders for any host that's not on the manifest's
        # rate-limit map yet.
        time.sleep(0.2)
    return results


def _plant_dedupe_prospects(sb) -> list[dict]:
    """Plant the 2 dedupe-test prospects required by T07 + T10."""
    out: list[dict] = []

    bso_payload = {
        "company_name": "Boston Symphony Orchestra",
        "tier": "A",
        "state": "researching",
        "created_source": "manual",
        "source": "manual",
        "category": "amenity=concert_hall",
        "zip": "02115",
        "website": "https://www.bso.org/",
        "pipeline_notes": "t6 fixture — corporate_sponsor_pages dedupe collision",
    }
    bso_payload["business_key"] = compute_business_key(bso_payload)
    res = (
        sb.table("prospects")
        .upsert(bso_payload, on_conflict="business_key")
        .execute()
    )
    bso_id = (res.data or [{}])[0].get("id")
    out.append({"id": bso_id, "company_name": "Boston Symphony Orchestra"})

    glee_payload = {
        "company_name": "Harvard Glee Club",
        "tier": "B",
        "state": "researching",
        "created_source": "manual",
        "source": "manual",
        "zip": "02138",
        "website": "https://harvardgleeclub.org/",
        "pipeline_notes": "t6 fixture — harvard_orgs dedupe collision",
    }
    glee_payload["business_key"] = compute_business_key(glee_payload)
    res = (
        sb.table("prospects")
        .upsert(glee_payload, on_conflict="business_key")
        .execute()
    )
    glee_id = (res.data or [{}])[0].get("id")
    out.append({"id": glee_id, "company_name": "Harvard Glee Club"})
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--dry-run",
        action="store_true",
        help="Plan the work but do not write fixtures or plant prospects.",
    )
    ap.add_argument(
        "--skip-fetch",
        action="store_true",
        help="Plant DB rows + write snapshot, but skip the HTTP fetch step. "
        "Use when fixtures are already on disk.",
    )
    ap.add_argument(
        "--only-missing",
        action="store_true",
        help="Fetch only manifest entries that don't yet have a fixture file "
        "(or whose existing file is empty). Preserves prior good captures.",
    )
    args = ap.parse_args()

    if SNAPSHOT_PATH.exists() and not args.dry_run:
        print(f"REFUSE: {SNAPSHOT_PATH} exists. Run scripts/t6_cleanup.py first.")
        return 1

    started = dt.datetime.now(tz=dt.UTC).isoformat()
    print(f"=== T6 plant @ {started} ===")
    print(f"manifest: {len(_FETCH_MANIFEST)} fetch targets")
    print(f"fixture root: {FIXTURE_ROOT.relative_to(WHRB)}")
    print()

    print("Fetch step")
    print("----------")
    fetches = _capture_fixtures(
        dry_run=args.dry_run,
        skip_fetch=args.skip_fetch,
        only_missing=args.only_missing,
    )

    print()
    print("Plant step")
    print("----------")
    if args.dry_run:
        print("(dry-run; not planting prospects)")
        prospects: list[dict] = []
    else:
        sb = _client()
        prospects = _plant_dedupe_prospects(sb)
        for p in prospects:
            print(f"  upserted prospect {p['company_name']!r} -> id {p['id']}")

    snapshot = {
        "started": started,
        "fetches": fetches,
        "prospects": prospects,
    }
    if not args.dry_run:
        SNAPSHOT_PATH.parent.mkdir(parents=True, exist_ok=True)
        SNAPSHOT_PATH.write_text(json.dumps(snapshot, indent=2))
        print()
        print(f"OK plant complete. snapshot={SNAPSHOT_PATH}")
    else:
        print()
        print("OK plant DRY-RUN complete (no files / DB writes).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
