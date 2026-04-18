"""WHRB prospect pipeline orchestrator.

Runs every source, dedupes, enriches with free-tier tools, validates emails,
scores priority, and writes output/whrb_prospects.csv.

Usage:
    python pipeline.py                  # default run (no MA HIC, no BBB)
    python pipeline.py --dry            # skip slow Playwright enrichers (ma_sos)
    python pipeline.py --with-hic       # opt into MA HIC scraper (flaky; off by default)
    python pipeline.py --with-bbb       # opt into BBB Playwright scrape
"""
from __future__ import annotations

import argparse
import math
import sys
from pathlib import Path

import pandas as pd

from config import SCORE_WEIGHTS, WHRB_ZIPS
from enrich import apollo_free, contact_scraper, dedupe, email_validate, hunter_free
from sources import (
    best_of_boston,
    bbb,
    chambers,
    city_licenses,
    ma_hic,
    osm_overpass,
    program_books,
    yelp_fusion,
)
from util import checkpoint

PHASE_ORDER = [
    "01_collected",
    "02_filtered_deduped",
    "03_contact_scraped",
    "04_hunter",
    "05_apollo",
    "06_ma_sos",
    "07_validated",
]

OUTPUT = Path("output/whrb_prospects.csv")

CSV_COLUMNS = [
    "company_name", "website", "company_phone", "company_email", "sales_email",
    "contact_name", "contact_title", "contact_email", "contact_phone", "contact_linkedin",
    "address", "zip", "tier", "category", "rating", "review_count",
    "source", "priority_score", "seasonality_window", "pipeline_notes",
]

SEASONALITY = {
    "landscaping": "spring",
    "lawn care": "spring",
    "snow removal": "fall",
    "hvac": "spring/fall",
    "mover": "summer",
    "tax preparer": "winter",
    "painter": "spring",
}


def score(row: dict) -> int:
    s = 0
    w = SCORE_WEIGHTS
    if row.get("website"): s += w["has_website"]
    if row.get("company_phone") or row.get("contact_phone"): s += w["has_phone"]
    if row.get("contact_name"): s += w["has_contact_name"]
    if row.get("pipeline_notes") and "member" in row["pipeline_notes"]: s += w["in_chamber"]
    if row.get("review_count"):
        s += int(w["review_count_log"] * math.log10(max(1, int(row["review_count"]))))
    s += w.get(f"tier_{row.get('tier', '')}", 0)
    return s


def seasonality_for(category: str | None) -> str:
    if not category:
        return "year-round"
    for k, v in SEASONALITY.items():
        if k in category.lower():
            return v
    return "year-round"


def _safe_cached(label: str, fn) -> list[dict]:
    cached = checkpoint.load_source(label)
    if cached is not None:
        print(f"[{label}] loaded {len(cached)} rows from cache")
        return cached
    try:
        rows = fn()
    except Exception as e:
        print(f"[{label}] FAILED: {type(e).__name__}: {e}")
        return []
    checkpoint.save_source(label, rows)
    return rows


def collect(with_hic: bool, with_bbb: bool) -> list[dict]:
    rows: list[dict] = []
    rows += _safe_cached("osm",            osm_overpass.run_all)
    rows += _safe_cached("yelp",           yelp_fusion.run_all)
    if with_hic:
        rows += _safe_cached("ma_hic",     ma_hic.run_all)
    rows += _safe_cached("city_licenses",  city_licenses.run_all)
    rows += _safe_cached("chambers",       chambers.run_all)
    rows += _safe_cached("best_of_boston", best_of_boston.run_all)
    rows += _safe_cached("program_books",  program_books.run_all)
    from sources.program_books_fetcher import huntington_sponsors
    rows += _safe_cached("huntington",     huntington_sponsors)
    if with_bbb:
        rows += _safe_cached("bbb",        bbb.run_all)
    return rows


def filter_zips(rows: list[dict]) -> list[dict]:
    out = []
    for r in rows:
        z = (r.get("zip") or "")[:5]
        if not z or z in WHRB_ZIPS:
            out.append(r)
    return out


def _install_http_cache() -> None:
    try:
        import requests_cache
    except ImportError:
        print("[cache] requests-cache not installed; skipping HTTP cache")
        return
    Path("cache").mkdir(exist_ok=True)
    requests_cache.install_cache(
        "cache/http_cache",
        backend="sqlite",
        expire_after=60 * 60 * 24,
        allowable_methods=("GET",),
        allowable_codes=(200,),
        stale_if_error=True,
    )
    print("[cache] requests-cache installed (24h, sqlite)")


def main(argv: list[str]) -> None:
    parser = argparse.ArgumentParser(prog="pipeline")
    parser.add_argument("--dry", action="store_true",
                        help="skip slow Playwright enrichers (ma_sos)")
    parser.add_argument("--with-hic", action="store_true",
                        help="opt into MA HIC scraper (flaky, off by default)")
    parser.add_argument("--with-bbb", action="store_true",
                        help="opt into BBB Playwright scrape")
    parser.add_argument("--fresh", action="store_true",
                        help="ignore existing checkpoints and restart from source fetch")
    parser.add_argument("--no-resume", dest="fresh", action="store_true",
                        help="alias for --fresh")
    args = parser.parse_args(argv)

    print("== WHRB prospect pipeline ==")
    _install_http_cache()

    if args.fresh:
        checkpoint.clear_all()

    resume_name, rows = (None, None)
    if not args.fresh:
        resume_name, rows = checkpoint.load_latest(PHASE_ORDER)
    resume_idx = PHASE_ORDER.index(resume_name) if resume_name else -1
    if resume_name:
        print(f"[checkpoint] resuming from {resume_name} ({len(rows)} rows)")

    # Phase 01 — collect raw rows from every source
    if resume_idx < 0:
        rows = collect(with_hic=args.with_hic, with_bbb=args.with_bbb)
        print(f"collected {len(rows)} raw rows")
        checkpoint.save_phase("01_collected", rows)

    # Phase 02 — zip filter + dedupe
    if resume_idx < 1:
        rows = filter_zips(rows)
        rows = dedupe.dedupe(rows)
        checkpoint.save_phase("02_filtered_deduped", rows)

    # Phase 03 — website contact scraping (the long one)
    if resume_idx < 2:
        print("-- website contact scraping --")
        contact_scraper.enrich_rows(rows)
        checkpoint.save_phase("03_contact_scraped", rows)

    # Phase 04 — hunter free tier
    if resume_idx < 3:
        print("-- hunter.io free tier --")
        hunter_free.enrich_rows(rows, budget=25)
        checkpoint.save_phase("04_hunter", rows)

    # Phase 05 — apollo free tier
    if resume_idx < 4:
        print("-- apollo free tier --")
        apollo_free.enrich_rows(rows, budget=100)
        checkpoint.save_phase("05_apollo", rows)

    # Phase 06 — ma sos officer lookup (Playwright; skipped under --dry)
    if resume_idx < 5 and not args.dry:
        print("-- ma sos officer lookup --")
        from sources import ma_sos
        ma_sos.enrich_rows(rows, limit=25)
        checkpoint.save_phase("06_ma_sos", rows)

    # Phase 07 — email validation
    if resume_idx < 6:
        print("-- email validation --")
        email_validate.clean_rows(rows)
        checkpoint.save_phase("07_validated", rows)

    # Scoring + CSV write are cheap; always run so every invocation writes CSV.
    for r in rows:
        r["priority_score"] = score(r)
        r["seasonality_window"] = seasonality_for(r.get("category"))

    df = pd.DataFrame(rows)
    for c in CSV_COLUMNS:
        if c not in df.columns:
            df[c] = None
    df = df[CSV_COLUMNS].sort_values("priority_score", ascending=False)

    OUTPUT.parent.mkdir(exist_ok=True)
    df.to_csv(OUTPUT, index=False)
    print(f"wrote {len(df)} rows -> {OUTPUT}")


if __name__ == "__main__":
    main(sys.argv[1:])
