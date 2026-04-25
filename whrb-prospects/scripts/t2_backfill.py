#!/usr/bin/env python3
"""Stage T2 backfill — tag every pre-existing prospect deterministically.

Plan §4.4 contract:
    For every prospects row where no prospect_tags exist for (prospect_id):
      - Derive tags from: source (-> sector/operating_model),
                         zip (-> affiliation),
                         category (-> sector refinement).
      - existing `tier` has NO effect on tags.
      - Name-heuristic and keyword-derivation are OFF.
      - Empty axes left blank.
      - Insert prospect_tags rows with created_by=NULL.
      - Idempotent: if any tag exists for a prospect, skip it.

Usage:
    .venv/bin/python scripts/t2_backfill.py               # live run
    .venv/bin/python scripts/t2_backfill.py --dry-run     # report only
    .venv/bin/python scripts/t2_backfill.py --limit 50    # cap for smoke test

Exit codes:
  0  backfill completed
  1  unexpected error (details on stderr)
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

HERE = Path(__file__).resolve().parent
WHRB = HERE.parent
sys.path.insert(0, str(WHRB))
load_dotenv(WHRB / ".env")

from util.tags import (
    affiliation_for_zip,
    build_tag_set,
    city_category_to_tags,
    osm_category_to_tags,
    yelp_alias_to_tags,
)

# -------------------------------------------------------------------------
# Per-source derivation
# -------------------------------------------------------------------------
# A prospect row's ``source`` column may carry a single token or a
# comma-joined multi-source string from ``_merge``'s join. Deriving from
# the first token that matches is enough — the backfill's point is to
# add a floor, not to enrich.

_SECTOR_BY_SOURCE: dict[str, tuple[str | None, str | None]] = {
    "cambridge_diversity": (None, None),        # category-dependent
    "somerville_permits":  (None, None),        # category-dependent
    "boston_food":         ("hospitality", "retailer"),
    "hsba":                (None, None),        # affiliation-only
    "artsboston":          ("arts", None),      # sector hint
    "ma_hic_legacy":       ("home_services", "service_provider"),
    "ma_hic_modern":       ("home_services", "service_provider"),
    "huntington":          ("arts", "presenter"),
    "bbb":                 (None, None),
}

_AFFILIATION_BY_SOURCE: dict[str, str] = {
    "hsba":                "cambridge_based",
    "artsboston":          "boston_based",
    "cambridge_diversity": "cambridge_based",
    "somerville_permits":  "greater_boston",
    "boston_food":         "boston_based",
    "huntington":          "boston_based",
}


# pipeline.seasonality_for() populates ``seasonality_window`` from the row's
# category at scrape time. We re-use that column (same provenance: category)
# as the deterministic source for cadence tags — no fresh derivation.
_SEASONALITY_TO_CADENCE: dict[str, list[str]] = {
    "year-round":  ["year_round"],
    "spring":      ["seasonal_spring"],
    "summer":      ["seasonal_summer"],
    "fall":        ["seasonal_fall"],
    "winter":      ["seasonal_winter"],
    "spring/fall": ["seasonal_spring", "seasonal_fall"],
}


def _first_source_token(value: str | None) -> str | None:
    if not value:
        return None
    for tok in str(value).split(","):
        t = tok.strip()
        if t:
            return t
    return None


def _cadence_from_seasonality(seasonality: str | None) -> list[str]:
    """Map ``pipeline.seasonality_for`` output → cadence vocab values."""
    if not seasonality:
        return []
    return list(_SEASONALITY_TO_CADENCE.get(str(seasonality).strip().lower(), []))


def _derive_tags(row: dict) -> dict[str, list[str]]:
    """Return ``{axis: [values]}`` derived from already-scraped columns only.

    No name-heuristic lookups; no category keyword fuzzing beyond the
    mappings already used by source emitters. This is deliberately the
    floor of what we know from columns — T3 / T4 widen the evidence base
    via rep edits.

    Cadence is derived from ``seasonality_window``, which the pipeline
    itself populates from ``category`` via ``pipeline.seasonality_for``.
    Sharing provenance keeps the backfill within the plan's
    ``category -> axis refinement`` envelope.
    """
    source = _first_source_token(row.get("source"))
    zip_ = (row.get("zip") or "")[:5] or None
    category = row.get("category")
    seasonality = row.get("seasonality_window")
    cadence_values = _cadence_from_seasonality(seasonality)

    sector: str | None = None
    operating_model: str | None = None

    # Per-source floor.
    if source and source in _SECTOR_BY_SOURCE:
        sector, operating_model = _SECTOR_BY_SOURCE[source]

    # Category-driven refinement — only when the source itself doesn't
    # already pin both axes.
    if source == "osm" or (source and source.startswith("osm")):
        osm_sector, osm_model = osm_category_to_tags(category)
        sector = sector or osm_sector
        operating_model = operating_model or osm_model
    elif source == "yelp":
        yelp_sector, yelp_model = yelp_alias_to_tags(category)
        sector = sector or yelp_sector
        operating_model = operating_model or yelp_model
    elif source in {"cambridge_diversity", "somerville_permits", "boston_food"}:
        city_sector, city_model = city_category_to_tags(source, category)
        sector = sector or city_sector
        operating_model = operating_model or city_model

    # Affiliation: zip → source-hint → None.
    affiliation = affiliation_for_zip(zip_) or _AFFILIATION_BY_SOURCE.get(source)

    if source == "artsboston":
        # Emit the nonprofit sector alongside arts — matches emitter.
        tags = build_tag_set(
            sector=["arts", "nonprofit"],
            operating_model=operating_model,
            affiliation=affiliation,
            cadence=cadence_values or None,
            source=f"backfill:{source}",
        )
    elif source and source.startswith("program_book"):
        # Program-book rows come in as `program_book:<stem>` so we know
        # they are arts nonprofits but we don't have the genre inference
        # available from the filename anymore. Leave genre blank —
        # rep-assigned tags fill it in later.
        tags = build_tag_set(
            sector=["arts", "nonprofit"],
            history="program_book_sponsor",
            affiliation=affiliation,
            cadence=cadence_values or None,
            source=f"backfill:{source}",
        )
    else:
        tags = build_tag_set(
            sector=sector,
            operating_model=operating_model,
            affiliation=affiliation,
            cadence=cadence_values or None,
            source=f"backfill:{source or 'unknown'}",
        )
    return tags


# -------------------------------------------------------------------------
# DB helpers
# -------------------------------------------------------------------------

def _client():
    return create_client(
        os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    )


def _vocab_lookup(sb) -> dict[tuple[str, str], str]:
    rows = (
        sb.table("tag_vocabulary")
        .select("id,axis,value,status")
        .eq("status", "active")
        .execute()
        .data
        or []
    )
    return {(r["axis"], r["value"]): r["id"] for r in rows}


def _tagged_prospect_ids(sb) -> set[str]:
    """Paginated scan of prospect_tags.prospect_id — skipped by backfill.

    PostgREST defaults to a 1000-row limit regardless of ``.range()``, so
    the pagination has to match that cap or the scan silently truncates.
    """
    page = 0
    page_size = 1000
    out: set[str] = set()
    while True:
        res = (
            sb.table("prospect_tags")
            .select("prospect_id")
            .range(page * page_size, (page + 1) * page_size - 1)
            .execute()
        )
        rows = res.data or []
        if not rows:
            break
        for r in rows:
            out.add(r["prospect_id"])
        if len(rows) < page_size:
            break
        page += 1
    return out


def _iter_prospects(sb, limit: int | None):
    """Paginated scan of prospects. Yields dicts with the columns we need."""
    page = 0
    page_size = 1000
    yielded = 0
    while True:
        res = (
            sb.table("prospects")
            .select("id,business_key,source,zip,category,seasonality_window")
            .range(page * page_size, (page + 1) * page_size - 1)
            .execute()
        )
        rows = res.data or []
        if not rows:
            break
        for r in rows:
            yield r
            yielded += 1
            if limit and yielded >= limit:
                return
        if len(rows) < page_size:
            break
        page += 1


# -------------------------------------------------------------------------
# Driver
# -------------------------------------------------------------------------

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Cap prospects scanned (smoke test). None = all.",
    )
    ap.add_argument(
        "--batch-size",
        type=int,
        default=500,
        help="Rows-per-insert batch size.",
    )
    args = ap.parse_args()

    sb = _client()
    vocab = _vocab_lookup(sb)
    already_tagged = _tagged_prospect_ids(sb)
    print(
        f"[t2_backfill] {len(already_tagged):,} prospects already have tags; "
        f"starting scan..."
    )

    total_considered = 0
    total_skipped = 0
    total_rows_to_insert = 0
    vocab_misses = 0
    batch: list[dict] = []

    def _flush():
        nonlocal batch
        if not batch:
            return
        if args.dry_run:
            print(f"(dry-run) would insert {len(batch)} prospect_tags rows")
            batch = []
            return
        sb.table("prospect_tags").upsert(
            batch,
            on_conflict="prospect_id,tag_id",
            ignore_duplicates=True,
        ).execute()
        batch = []

    for p in _iter_prospects(sb, args.limit):
        total_considered += 1
        if p["id"] in already_tagged:
            total_skipped += 1
            continue
        tags = _derive_tags(p)
        if not tags:
            total_skipped += 1
            continue
        for axis, values in tags.items():
            for v in values:
                tag_id = vocab.get((axis, v))
                if not tag_id:
                    vocab_misses += 1
                    continue
                batch.append({
                    "prospect_id": p["id"],
                    "tag_id": tag_id,
                    "created_by": None,
                })
                total_rows_to_insert += 1
                if len(batch) >= args.batch_size:
                    _flush()
    _flush()

    print(
        f"[t2_backfill] considered={total_considered:,} "
        f"skipped={total_skipped:,} "
        f"prospect_tags_to_insert={total_rows_to_insert:,} "
        f"vocab_misses={vocab_misses}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
