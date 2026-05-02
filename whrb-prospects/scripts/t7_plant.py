#!/usr/bin/env python3
"""Stage T7 plant — fetch fixtures + plant dedupe-test prospects.

Plan §9.7: ``t7_plant.py`` captures fixture CSV/HTML snapshots for each
of the new T7 sources and pre-approves vocab batch.

The runtime posture differs from T6 in one important way: T7's bulk-CSV
sources mostly live behind .gov download endpoints that this sandbox
cannot reach. The plant therefore uses **live-fetch with stub
fallback** (per the user-confirmed strategy):

  * For each manifest entry, attempt ``http_get(LIVE_URL)``.
  * On any failure (HTTP error / DNS / SSL / 403 / etc.), preserve the
    pre-committed hand-crafted stub fixture at
    ``tests/fixtures/t7/<source>/<slug>.<ext>`` and record
    ``status='live-fetch-failed; stub preserved'`` in the snapshot.
  * On success, **only** overwrite the stub when the fetched content
    parses (``len(_emit_from_csv|html(text)) >= 1``). This prevents a
    bot-challenge-page (Incapsula HTML) from clobbering a working
    stub.

Plus, plants per-pair dedupe-test prospects so the C3 collision tests
have something to match against in DB-mode (the integrity script also
verifies collisions at the parse level when DB is unavailable).

Snapshot at ``cache/t7_snapshot.json``. Idempotent: refuses to re-run
while the snapshot exists.

Usage:
    .venv/bin/python scripts/t7_plant.py            # live-fetch + plant
    .venv/bin/python scripts/t7_plant.py --dry-run  # plan only
    .venv/bin/python scripts/t7_plant.py --skip-fetch  # plant only
    .venv/bin/python scripts/t7_plant.py --only-missing  # only fetch
                                                          missing fixtures
"""
from __future__ import annotations

import argparse
import datetime as dt
import importlib
import json
import os
import sys
import time
from pathlib import Path

import requests
from dotenv import load_dotenv

HERE = Path(__file__).resolve().parent
WHRB = HERE.parent
sys.path.insert(0, str(WHRB))
load_dotenv(WHRB / ".env")

from db.supabase_sync import business_key as compute_business_key
from scripts.t7_source_manifest import (
    T7_SOURCE_MANIFEST,
    T7SourceSpec,
    dedupe_partner_pairs,
)
from sources._t7_common import (
    FIXTURE_ROOT,
    HTTP_TIMEOUT_SECONDS,
    RATE_LIMIT_SECONDS,
    USER_AGENT,
    per_host_sleep,
)

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

SNAPSHOT_PATH = WHRB / "cache" / "t7_snapshot.json"


# ---------------------------------------------------------------------------
# Manifest expansion: map (source, slug) -> live URL
# ---------------------------------------------------------------------------


def _live_url_for(spec: T7SourceSpec, slug: str) -> str | None:
    """Resolve the live URL for ``(source, slug)`` from the source module.

    Bulk-CSV sources expose a single ``LIVE_URL`` constant for their
    primary slug; multi-slug sources (analyze_boston_extras,
    cambridge_permits) expose ``_DATASETS[slug]['url']``.
    """
    mod = importlib.import_module(f"sources.{spec.module}")
    if hasattr(mod, "_DATASETS") and slug in mod._DATASETS:
        return mod._DATASETS[slug].get("url")
    if hasattr(mod, "LIVE_URL"):
        return mod.LIVE_URL
    return None


# ---------------------------------------------------------------------------
# Fetch step
# ---------------------------------------------------------------------------


def _fetch_one(url: str) -> tuple[int, str]:
    """Fetch URL with retry on 5xx / 429. Returns (status, body) for
    every other outcome so the caller can distinguish 4xx (preserve
    stub) from 2xx (overwrite stub) without help.
    """
    last_status = 0
    last_body = ""
    for attempt in range(3):
        per_host_sleep(url, seconds=RATE_LIMIT_SECONDS)
        r = requests.get(
            url,
            headers={"User-Agent": USER_AGENT},
            timeout=HTTP_TIMEOUT_SECONDS,
            allow_redirects=True,
        )
        last_status, last_body = r.status_code, r.text
        retryable = r.status_code == 429 or 500 <= r.status_code < 600
        if retryable and attempt < 2:
            time.sleep(2 * (attempt + 1))  # 2s, 4s
            continue
        break
    return last_status, last_body


def _parser_accepts(spec: T7SourceSpec, slug: str, text: str) -> bool:
    """Return True iff the source module would emit at least 1 row from
    *text*. Used to validate live fetches before overwriting stubs.

    Dispatches by signature: modules with a ``_DATASETS`` dict accept
    ``(slug, text)``; single-slug modules accept ``(text)``. Detecting via
    attribute presence avoids the prior ``try/except TypeError`` shape,
    which silently swallowed unrelated TypeErrors raised inside the
    parser.
    """
    if not text or len(text) < 200:
        # Empty / tiny payloads (error pages, redirects without body) can
        # never represent a parseable directory.
        return False
    mod = importlib.import_module(f"sources.{spec.module}")
    parser = getattr(mod, "_emit_from_csv", None) or getattr(mod, "_emit_from_html", None)
    if parser is None:
        return False
    try:
        rows = parser(slug, text) if hasattr(mod, "_DATASETS") else parser(text)
    except Exception:
        return False
    return len(rows) >= 1


def _capture_fixtures(
    *, dry_run: bool, skip_fetch: bool, only_missing: bool = False
) -> list[dict]:
    results: list[dict] = []
    for spec in T7_SOURCE_MANIFEST:
        for slug in spec.fixture_slugs:
            target_dir = FIXTURE_ROOT / spec.source_key
            target_dir.mkdir(parents=True, exist_ok=True)
            target_file = target_dir / f"{slug}.{spec.fixture_ext}"
            stub_existed = target_file.exists() and target_file.stat().st_size > 0

            rec: dict = {
                "source_key": spec.source_key,
                "slug": slug,
                "ext": spec.fixture_ext,
                "url": _live_url_for(spec, slug),
                "path": str(target_file.relative_to(WHRB)),
                "stub_existed": stub_existed,
            }

            if skip_fetch and stub_existed:
                rec["status"] = "skip-fetch (stub preserved)"
                rec["bytes"] = target_file.stat().st_size
                results.append(rec)
                print(f"  [skip-fetch] {spec.source_key}/{slug}.{spec.fixture_ext} ({rec['bytes']} bytes)")
                continue
            if only_missing and stub_existed:
                rec["status"] = "only-missing-skip"
                rec["bytes"] = target_file.stat().st_size
                results.append(rec)
                print(f"  [only-missing-skip] {spec.source_key}/{slug}.{spec.fixture_ext} ({rec['bytes']} bytes)")
                continue
            if dry_run:
                rec["status"] = "dry-run"
                results.append(rec)
                print(f"  [dry-run] would fetch {rec['url']}")
                continue
            url = rec["url"]
            if not url:
                rec["status"] = "no-live-url"
                results.append(rec)
                print(f"  [no-url] {spec.source_key}/{slug}: stub preserved")
                continue
            try:
                status_code, body = _fetch_one(url)
                rec["status_code"] = status_code
                rec["fetched_bytes"] = len(body)
                if status_code >= 400:
                    rec["status"] = f"http-{status_code} (stub preserved)"
                    print(f"  [http {status_code}] {spec.source_key}/{slug}: stub preserved")
                elif _parser_accepts(spec, slug, body):
                    target_file.write_text(body, encoding="utf-8")
                    rec["status"] = "ok-overwrote-stub"
                    print(f"  [ok] {spec.source_key}/{slug} ← {url} ({len(body):,} bytes)")
                else:
                    rec["status"] = "live-parse-failed (stub preserved)"
                    print(f"  [parse-fail] {spec.source_key}/{slug}: stub preserved")
            except Exception as exc:
                rec["status"] = f"fetch-error (stub preserved): {type(exc).__name__}"
                rec["error"] = f"{type(exc).__name__}: {exc}"
                print(f"  [error] {spec.source_key}/{slug}: stub preserved ({type(exc).__name__})")
            results.append(rec)
            time.sleep(0.2)
    return results


# ---------------------------------------------------------------------------
# Plant: collision-test prospects
# ---------------------------------------------------------------------------


_PLANT_PROSPECTS: list[dict] = [
    # Pre-seed one prospect per dedupe pair the manifest lists, so live-DB
    # C3 tests have a guaranteed collision target. Names match those used
    # in the per-pair fixtures.
    {
        "company_name": "Beacon Hill Capital Partners",
        "tier": "A",
        "zip": "02138",
        "category": "finance/investment_adviser",
        "pipeline_notes": "t7 fixture — sec_adv↔ma_dpu_movers",
    },
    {
        "company_name": "Cambridge Senior Care",
        "tier": "A",
        "zip": "02138",
        "category": "medical/assisted_living",
        "pipeline_notes": "t7 fixture — ma_alr↔mvma_vets",
    },
    {
        "company_name": "Cambridge Friends School",
        "tier": "A",
        "zip": "02140",
        "category": "education/nonpublic_school",
        "pipeline_notes": "t7 fixture — ma_dese_nonpublic↔ams_schools",
    },
    {
        "company_name": "Hyatt Regency Boston",
        "tier": "B",
        "zip": "02139",
        "category": "hospitality/liquor_license",
        "pipeline_notes": "t7 fixture — analyze_boston_extras↔meet_boston",
    },
    {
        "company_name": "Patriot Plumbing & Heating",
        "tier": "C",
        "zip": "02138",
        "category": "home_services/plumbing",
        "pipeline_notes": "t7 fixture — cambridge_permits↔ma_landscape_pros",
    },
    {
        "company_name": "Cambridge Arts Center",
        "tier": "B",
        "zip": "02138",
        "category": "arts/visual_arts",
        "pipeline_notes": "t7 fixture — mapc_creative_economy↔masscreative",
    },
    {
        "company_name": "Boston Ballet",
        "tier": "A",
        "zip": "02116",
        "category": "arts/dance",
        "pipeline_notes": "t7 fixture — ma_cultural_council↔masscreative",
    },
    {
        "company_name": "New England Conservatory",
        "tier": "A",
        "zip": "02115",
        "category": "education/music_education",
        "pipeline_notes": "t7 fixture — nefa_grantees↔ma_cultural_council",
    },
    {
        "company_name": "Green Thumb Landscaping",
        "tier": "C",
        "zip": "02138",
        "category": "home_services/arborist",
        "pipeline_notes": "t7 fixture — ma_arborists↔ma_landscape_pros",
    },
    {
        "company_name": "Boston Properties Services",
        "tier": "C",
        "zip": "02116",
        "category": "real_estate/home_inspector",
        "pipeline_notes": "t7 fixture — ashi_ne↔cambridge_permits",
    },
    {
        "company_name": "Boston Genomics",
        "tier": "A",
        "zip": "02139",
        "category": "technology/biotech",
        "pipeline_notes": "t7 fixture — massbio↔masstlc",
    },
    {
        "company_name": "Greater Boston Eco Services",
        "tier": "C",
        "zip": "02143",
        "category": "home_services/hpin",
        "pipeline_notes": "t7 fixture — mass_save_hpin↔ma_landscape_pros",
    },
]


def _plant_dedupe_prospects(sb) -> list[dict]:
    out: list[dict] = []
    for proto in _PLANT_PROSPECTS:
        payload = dict(proto)
        payload["state"] = "researching"
        payload["created_source"] = "manual"
        payload["source"] = "manual"
        payload["business_key"] = compute_business_key(payload)
        res = (
            sb.table("prospects")
            .upsert(payload, on_conflict="business_key")
            .execute()
        )
        rid = (res.data or [{}])[0].get("id")
        out.append({"id": rid, "company_name": payload["company_name"]})
    return out


def _client():
    # Import lazily so ``--dry-run`` works in environments without the
    # ``supabase`` package installed.
    from supabase import create_client

    return create_client(SUPABASE_URL, SERVICE_KEY)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--skip-fetch", action="store_true")
    ap.add_argument("--only-missing", action="store_true")
    args = ap.parse_args()

    if SNAPSHOT_PATH.exists() and not args.dry_run:
        print(f"REFUSE: {SNAPSHOT_PATH} exists. Run scripts/t7_cleanup.py first.")
        return 1

    started = dt.datetime.now(tz=dt.UTC).isoformat()
    print(f"=== T7 plant @ {started} ===")
    print(f"sources: {len(T7_SOURCE_MANIFEST)}")
    n_fixtures = sum(len(s.fixture_slugs) for s in T7_SOURCE_MANIFEST)
    print(f"fixture slugs: {n_fixtures}")
    print(f"fixture root: {FIXTURE_ROOT.relative_to(WHRB)}")
    print()

    print("Fetch step (live-fetch w/ stub fallback)")
    print("-----------------------------------------")
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
    elif not (SUPABASE_URL and SERVICE_KEY):
        print("(SUPABASE creds missing; skipping plant — fixture-only mode)")
        prospects = []
    else:
        sb = _client()
        prospects = _plant_dedupe_prospects(sb)
        for p in prospects:
            print(f"  upserted prospect {p['company_name']!r} -> id {p['id']}")

    snapshot = {
        "started": started,
        "fetches": fetches,
        "prospects": prospects,
        "dedupe_pairs": dedupe_partner_pairs(),
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
