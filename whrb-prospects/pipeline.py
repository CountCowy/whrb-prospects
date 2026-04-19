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
from util import checkpoint, event_log

PHASE_ORDER = [
    "01_collected",
    "02_filtered_deduped",
    "03_contact_scraped",
    "04_hunter",
    "05_apollo",
    "06_ma_sos",
    "07_validated",
    "07a_nonprofit",
    "08_supabase_sync",
]

OUTPUT = Path("output/whrb_prospects.csv")

CSV_COLUMNS = [
    "company_name", "website", "company_phone", "company_email", "sales_email",
    "contact_name", "contact_title", "contact_email", "contact_phone", "contact_linkedin",
    "address", "zip", "tier", "category", "rating", "review_count",
    "source", "priority_score", "seasonality_window", "pipeline_notes",
    "is_nonprofit", "nonprofit_source", "ein",
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
        event_log.error(
            "source_failed",
            f"source {label} failed: {type(e).__name__}: {e}",
            context={"source": label, "exception": type(e).__name__, "detail": str(e)[:500]},
        )
        return []
    checkpoint.save_source(label, rows)
    return rows


def collect(with_hic: bool, with_bbb: bool, enabled: set[str] | None = None) -> list[dict]:
    """Run each source scraper. ``enabled`` filters by source_key — ``None``
    means every scraper runs (no DB filter applied)."""
    def _on(key: str) -> bool:
        return enabled is None or key in enabled

    rows: list[dict] = []
    if _on("osm"):            rows += _safe_cached("osm",            osm_overpass.run_all)
    if _on("yelp"):           rows += _safe_cached("yelp",           yelp_fusion.run_all)
    if with_hic and _on("ma_hic"):
        rows += _safe_cached("ma_hic",     ma_hic.run_all)
    if _on("city_licenses"):  rows += _safe_cached("city_licenses",  city_licenses.run_all)
    if _on("chambers"):       rows += _safe_cached("chambers",       chambers.run_all)
    if _on("best_of_boston"): rows += _safe_cached("best_of_boston", best_of_boston.run_all)
    if _on("program_books"):  rows += _safe_cached("program_books",  program_books.run_all)
    if _on("huntington"):
        from sources.program_books_fetcher import huntington_sponsors
        rows += _safe_cached("huntington", huntington_sponsors)
    if with_bbb and _on("bbb"):
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


def _start_pipeline_run(argv: list[str]) -> str | None:
    """Insert a `pipeline_runs` row, stamp the logger, return the id.

    Round-7: required for every run (CLI + web). CLI runs have
    ``triggered_by=null``; ``args`` captures the argv string.

    Returns ``None`` if the DB is unreachable — the pipeline still runs to
    produce a CSV; events just won't be correlated.
    """
    try:
        from datetime import datetime, timezone
        import os

        from dotenv import load_dotenv
        from supabase import create_client

        load_dotenv(Path(__file__).resolve().parent / ".env")
        url = os.environ.get("SUPABASE_URL")
        key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        if not url or not key:
            print("[pipeline_runs] no Supabase creds; skipping run record")
            return None
        client = create_client(url, key)
        row = {
            "status": "running",
            "started_at": datetime.now(tz=timezone.utc).isoformat(),
            "args": " ".join(argv) if argv else "",
        }
        res = client.table("pipeline_runs").insert(row).execute()
        run_id = (res.data[0] if res.data else {}).get("id")
        event_log.set_pipeline_run_id(run_id)
        print(f"[pipeline_runs] run_id={run_id}")
        return run_id
    except Exception as e:  # noqa: BLE001
        print(f"[pipeline_runs] failed to create run row: {type(e).__name__}: {e}")
        return None


def _finish_pipeline_run(run_id: str | None, *, status: str, rows_upserted: int | None, error: str | None) -> None:
    if not run_id:
        return
    try:
        from datetime import datetime, timezone
        import os

        from supabase import create_client

        client = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])
        patch: dict = {
            "status": status,
            "finished_at": datetime.now(tz=timezone.utc).isoformat(),
        }
        if rows_upserted is not None:
            patch["rows_upserted"] = rows_upserted
        if error:
            patch["error"] = error[:4000]
        client.table("pipeline_runs").update(patch).eq("id", run_id).execute()
    except Exception as e:  # noqa: BLE001
        print(f"[pipeline_runs] failed to finalize: {type(e).__name__}: {e}")


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
    parser.add_argument("--no-supabase", action="store_true",
                        help="skip phase 08_supabase_sync (still writes CSV)")
    args = parser.parse_args(argv)

    print("== WHRB prospect pipeline ==")
    _install_http_cache()

    # Round-7: every run gets a pipeline_runs row. CLI path uses triggered_by=null.
    run_id = None if args.no_supabase else _start_pipeline_run(argv)
    event_log.info(
        "run_start",
        "pipeline run started",
        context={"argv": argv, "no_supabase": args.no_supabase},
    )

    enabled_sources: set[str] | None = None
    if not args.no_supabase:
        try:
            from db import supabase_sync
            supabase_sync.seed_source_config()
            enabled_sources = supabase_sync.read_enabled_sources()
            print(f"[source_config] enabled scrapers: {sorted(enabled_sources)}")
        except Exception as e:  # noqa: BLE001
            print(f"[source_config] skipped due to error: {type(e).__name__}: {e}")
            event_log.error(
                "source_config_bootstrap_failed",
                f"source_config bootstrap failed: {type(e).__name__}: {e}",
                context={"exception": type(e).__name__},
            )
            enabled_sources = None

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
        rows = collect(
            with_hic=args.with_hic,
            with_bbb=args.with_bbb,
            enabled=enabled_sources,
        )
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

    # Phase 07a — IRS BMF nonprofit enrichment
    if resume_idx < 7:
        print("-- nonprofit BMF enrichment --")
        from db import nonprofit_bmf
        try:
            nonprofit_bmf.enrich_rows(rows)
        except Exception as e:  # noqa: BLE001
            print(f"[nonprofit_bmf] FAILED: {type(e).__name__}: {e}")
            event_log.error(
                "bmf_enrichment_failed",
                f"BMF enrichment failed: {type(e).__name__}: {e}",
                context={"exception": type(e).__name__, "detail": str(e)[:500]},
            )
        checkpoint.save_phase("07a_nonprofit", rows)

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

    # Phase 08 — Supabase sync. Wrapped so a sync failure never loses the CSV.
    sync_summary: dict | None = None
    sync_error: str | None = None
    if not args.no_supabase:
        try:
            from db import supabase_sync
            print("-- supabase sync --")
            sync_summary = supabase_sync.sync(df.to_dict(orient="records"))
            print(f"[supabase_sync] {sync_summary}")
            checkpoint.save_phase("08_supabase_sync", rows)
        except Exception as e:  # noqa: BLE001
            sync_error = f"{type(e).__name__}: {e}"
            print(f"[supabase_sync] FAILED: {sync_error}")
            event_log.error(
                "supabase_sync_aborted",
                f"sync phase aborted: {sync_error}",
                context={"exception": type(e).__name__, "detail": str(e)[:500]},
            )

    # run_finish event + pipeline_runs row update
    rows_upserted = None
    if sync_summary:
        rows_upserted = sync_summary.get("inserted", 0) + sync_summary.get("updated", 0)
    status = "success"
    if sync_error:
        status = "failed"
    elif sync_summary and sync_summary.get("failed", 0) > 0:
        status = "failed"
    event_log.info(
        "run_finish",
        f"pipeline run finished ({status})",
        context={
            "rows_written": len(df),
            "sync_summary": sync_summary,
            "status": status,
            "sync_error": sync_error,
        },
    )
    event_log.flush()
    _finish_pipeline_run(
        run_id,
        status=status,
        rows_upserted=rows_upserted,
        error=sync_error,
    )


if __name__ == "__main__":
    main(sys.argv[1:])
