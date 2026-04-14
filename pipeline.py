"""WHRB prospect pipeline orchestrator.

Runs every source, dedupes, enriches with free-tier tools, validates emails,
scores priority, and writes output/whrb_prospects.csv.

Usage:
    python pipeline.py           # full run
    python pipeline.py --dry     # skip slow Playwright sources
"""
from __future__ import annotations

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

OUTPUT = Path("output/whrb_prospects.csv")

CSV_COLUMNS = [
    "company_name", "website", "company_phone", "company_email", "sales_email",
    "contact_name", "contact_title", "contact_email", "contact_phone", "contact_linkedin",
    "address", "zip", "tier", "category", "rating", "review_count",
    "source", "priority_score", "seasonality_window", "notes",
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
    if row.get("notes") and "member" in row["notes"]: s += w["in_chamber"]
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


def collect(dry: bool) -> list[dict]:
    rows: list[dict] = []
    rows += osm_overpass.run_all()
    rows += yelp_fusion.run_all()
    rows += ma_hic.run_all()
    rows += city_licenses.run_all()
    rows += chambers.run_all()
    rows += best_of_boston.run_all()
    rows += program_books.run_all()
    # Huntington has no program PDFs — scrape their sponsor page directly
    from sources.program_books_fetcher import huntington_sponsors
    rows += huntington_sponsors()
    if not dry:
        rows += bbb.run_all()
    return rows


def filter_zips(rows: list[dict]) -> list[dict]:
    out = []
    for r in rows:
        z = (r.get("zip") or "")[:5]
        if not z or z in WHRB_ZIPS:
            out.append(r)
    return out


def main(argv: list[str]) -> None:
    dry = "--dry" in argv
    print("== WHRB prospect pipeline ==")

    rows = collect(dry=dry)
    print(f"collected {len(rows)} raw rows")

    rows = filter_zips(rows)
    rows = dedupe.dedupe(rows)

    # Enrichment order: cheapest first, paid-tier last
    print("-- website contact scraping --")
    contact_scraper.enrich_rows(rows)

    print("-- hunter.io free tier --")
    hunter_free.enrich_rows(rows, budget=25)

    print("-- apollo free tier --")
    apollo_free.enrich_rows(rows, budget=100)

    if not dry:
        print("-- ma sos officer lookup --")
        from sources import ma_sos
        ma_sos.enrich_rows(rows, limit=50)

    print("-- email validation --")
    email_validate.clean_rows(rows)

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
