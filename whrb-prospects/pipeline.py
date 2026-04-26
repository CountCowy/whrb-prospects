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
from collections.abc import Callable
from datetime import UTC
from pathlib import Path

import pandas as pd

from config import (
    ENABLED_SOURCES_DEFAULT,
    SCORE_WEIGHTS,
    SCORE_WEIGHTS_V2,
    SCORE_WEIGHTS_V2_LAUNCH,
    TAG_AXES_BUDGET_SIGNAL,
    WHRB_ZIPS,
)
from enrich import apollo_free, contact_scraper, dedupe, email_validate, hunter_free
from sources import (
    bbb,
    best_of_boston,
    chambers,
    city_licenses,
    ma_hic,
    osm_overpass,
    program_books,
    yelp_fusion,
)
from util import cannabis_block, checkpoint, event_log

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
    "08_b_tag_sync",
]

# Per-axis tag columns emitted into the CSV for downstream analysts. Mirrors
# plan §4.4 "CSV export tag columns". Values within each column are
# comma-joined and alphabetically sorted for deterministic diffs.
TAG_AXES_FOR_CSV: tuple[str, ...] = (
    "sector",
    "operating_model",
    "genre",
    "affiliation",
    "cadence",
    "daypart_fit",
    "history",
    "compliance",
    "other",
)

TAG_CSV_COLUMNS: tuple[str, ...] = tuple(f"tags_{axis}" for axis in TAG_AXES_FOR_CSV)

OUTPUT = Path("output/whrb_prospects.csv")

CSV_COLUMNS = [
    "company_name", "website", "company_phone", "company_email", "sales_email",
    "contact_name", "contact_title", "contact_email", "contact_phone", "contact_linkedin",
    "address", "zip", "tier", "category", "rating", "review_count",
    "source", "priority_score", "seasonality_window", "pipeline_notes",
    "is_nonprofit", "nonprofit_source", "ein",
    # Tag columns (Stage T2). Always appended — empty string for rows the
    # emitter skipped. Mirror order in TAG_CSV_COLUMNS.
    *TAG_CSV_COLUMNS,
]


def _serialize_tags_to_csv(row: dict) -> None:
    """Mutate ``row`` in place: expand ``row['tags']`` into per-axis columns.

    Missing axes render as empty string so the CSV column is always present.
    Values within each column are comma-joined + sorted so two identical
    emitter outputs produce byte-identical CSV fields.
    """
    tags = row.get("tags") or {}
    for axis in TAG_AXES_FOR_CSV:
        values = tags.get(axis) or []
        row[f"tags_{axis}"] = ",".join(sorted(set(values)))

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
    """Compute the priority score for a single prospect row.

    T4 launch (`SCORE_WEIGHTS_V2_LAUNCH=True`): equal-weight contributing
    signals — base from tier; +1 per budget-signal axis present; +1 for a
    populated `history` axis; +1 for Harvard or MIT affiliation; -20 per
    compliance-axis tag. See plan §1.3 #12 + config.SCORE_WEIGHTS_V2.

    Legacy fallback (`SCORE_WEIGHTS_V2_LAUNCH=False`): pre-T4 weighting
    using website/phone/contact-name/chamber/review_count signals. Kept
    so the toggle is a single boolean flip, no redeploy.

    Tags are read from `row["tags"]` (the {axis: [values]} dict the
    sources emit). A row with no tags scores tier-only.
    """
    if not SCORE_WEIGHTS_V2_LAUNCH:
        s = 0
        w = SCORE_WEIGHTS
        if row.get("website"): s += w["has_website"]
        if row.get("company_phone") or row.get("contact_phone"): s += w["has_phone"]
        if row.get("contact_name"): s += w["has_contact_name"]
        if row.get("pipeline_notes") and "member" in row["pipeline_notes"]:
            s += w["in_chamber"]
        if row.get("review_count"):
            s += int(w["review_count_log"] * math.log10(max(1, int(row["review_count"]))))
        s += w.get(f"tier_{row.get('tier', '')}", 0)
        return s

    w = SCORE_WEIGHTS_V2
    s = w.get(f"tier_{row.get('tier', '')}", 0)

    tags = row.get("tags") or {}

    # +1 per budget-signal axis with at least one tag.
    for axis in TAG_AXES_BUDGET_SIGNAL:
        if tags.get(axis):
            s += w["tag_budget_signal_each"]

    # +1 for any history-axis tag.
    if tags.get("history"):
        s += w["history_present"]

    # +1 for Harvard or MIT affiliation.
    affiliation = tags.get("affiliation") or []
    if any(v in ("harvard_affiliated", "mit_affiliated") for v in affiliation):
        s += w["affiliation_harvard_or_mit"]

    # -20 per compliance-axis value (cannabis is hard-blocked upstream;
    # this penalty applies to political / alcohol / gambling / etc.).
    for _ in tags.get("compliance") or []:
        s += w["compliance_each"]

    return s


def seasonality_for(category: str | None) -> str:
    if not category:
        return "year-round"
    for k, v in SEASONALITY.items():
        if k in category.lower():
            return v
    return "year-round"


def _safe_cached(label: str, fn: Callable[[], list[dict]]) -> list[dict]:
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

    Stage-10 extension: when the `WHRB_PIPELINE_RUN_ID` env var is set, the
    caller (the `run-pipeline.yml` GitHub Actions workflow) has already
    created the row and advanced it to ``running``. We simply adopt the id
    for event_log correlation and skip the INSERT/UPDATE entirely.

    Returns ``None`` if the DB is unreachable — the pipeline still runs to
    produce a CSV; events just won't be correlated.
    """
    import os

    adopted = os.environ.get("WHRB_PIPELINE_RUN_ID")
    if adopted:
        event_log.set_pipeline_run_id(adopted)
        print(f"[pipeline_runs] adopted run_id={adopted} (workflow-managed)")
        return adopted

    try:
        from datetime import datetime

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
            "started_at": datetime.now(tz=UTC).isoformat(),
            "args": " ".join(argv) if argv else "",
        }
        res = client.table("pipeline_runs").insert(row).execute()
        run_id = (res.data[0] if res.data else {}).get("id")
        event_log.set_pipeline_run_id(run_id)
        print(f"[pipeline_runs] run_id={run_id}")
        return run_id
    except Exception as e:
        print(f"[pipeline_runs] failed to create run row: {type(e).__name__}: {e}")
        return None


def _fanout_run_complete_notifications(
    run_id: str | None,
    *,
    status: str,
    rows_upserted: int | None,
    error: str | None,
) -> None:
    """Stage 10b: insert a `run_complete` notifications row for every admin
    whose `user_preferences.notify_run_complete_email` is true.

    Runs in both the CLI finalize path and the workflow-managed early-return
    path — the workflow itself does not own fan-out, only the pipeline_runs
    UPDATE. Fire-and-forget: any failure is logged but does not bubble up.
    """
    if not run_id:
        return
    import os

    try:
        from supabase import create_client

        url = os.environ.get("SUPABASE_URL")
        key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        if not url or not key:
            return
        client = create_client(url, key)

        admins = (
            client.table("profiles")
            .select("id,deactivated_at")
            .eq("role", "admin")
            .execute()
            .data
            or []
        )
        admin_ids = [
            a["id"] for a in admins if not a.get("deactivated_at")
        ]
        if not admin_ids:
            return

        prefs_rows = (
            client.table("user_preferences")
            .select("user_id,notify_run_complete_email")
            .in_("user_id", admin_ids)
            .execute()
            .data
            or []
        )
        prefs = {r["user_id"]: r["notify_run_complete_email"] for r in prefs_rows}

        recipients: list[str] = []
        for aid in admin_ids:
            # Default for notify_run_complete_email is false per 000_init.sql
            if prefs.get(aid, False):
                recipients.append(aid)

        if not recipients:
            return

        payload = {
            "pipeline_run_id": run_id,
            "status": status,
            "rows_upserted": rows_upserted,
            "error": (error or "")[:400] or None,
        }
        rows_to_insert = [
            {
                "recipient_id": rid,
                "kind": "run_complete",
                "actor_id": None,
                "prospect_id": None,
                "payload": payload,
            }
            for rid in recipients
        ]
        client.table("notifications").insert(rows_to_insert).execute()
        print(
            f"[run_complete] fanned out {len(rows_to_insert)} notification(s) to admins"
        )
    except Exception as e:
        print(f"[run_complete] fan-out failed: {type(e).__name__}: {e}")


# ---------- Tag-sync recovery helpers (plan §4.5) ---------- #

_TAG_EMIT_CACHE = Path("cache/last_tag_sync_emit.json")


def _mark_tag_sync_status(run_id: str | None, status: str) -> None:
    """Best-effort UPDATE of pipeline_runs.tag_sync_status.

    Status values: ``pending`` | ``ok`` | ``failed``. Never raises — a
    DB hiccup can't break the pipeline's ability to finish writing the
    CSV + run_finish event.
    """
    if not run_id or status not in {"pending", "ok", "failed"}:
        return
    import os

    try:
        from supabase import create_client

        client = create_client(
            os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"]
        )
        client.table("pipeline_runs").update(
            {"tag_sync_status": status}
        ).eq("id", run_id).execute()
    except Exception as e:
        print(
            f"[tag_sync] pipeline_runs.tag_sync_status={status} write suppressed: "
            f"{type(e).__name__}: {e}"
        )


def _write_last_tag_emit_cache(rows: list[dict]) -> None:
    """Persist the current emit set so retry_tag_sync.py can replay it."""
    import json

    payload = []
    for r in rows:
        tags = r.get("tags") or {}
        if not tags:
            continue
        payload.append(
            {
                "business_key": r.get("business_key"),
                "company_name": r.get("company_name"),
                "company_phone": r.get("company_phone"),
                "contact_phone": r.get("contact_phone"),
                "zip": r.get("zip"),
                "tags": tags,
            }
        )
    try:
        _TAG_EMIT_CACHE.parent.mkdir(parents=True, exist_ok=True)
        _TAG_EMIT_CACHE.write_text(json.dumps(payload, indent=2))
        print(f"[tag_sync] cached {len(payload)} rows to {_TAG_EMIT_CACHE}")
    except Exception as e:
        print(f"[tag_sync] emit-cache write suppressed: {type(e).__name__}: {e}")


def _clear_last_tag_emit_cache() -> None:
    try:
        if _TAG_EMIT_CACHE.exists():
            _TAG_EMIT_CACHE.unlink()
    except Exception:
        pass


def _finish_pipeline_run(run_id: str | None, *, status: str, rows_upserted: int | None, error: str | None) -> None:
    if not run_id:
        return
    # Stage-10: when the workflow owns the row (adopted via env var), it also
    # performs the final UPDATE with the parsed stdout summary — pipeline.py
    # must not compete with it. We still print a machine-readable summary line
    # so the workflow can scrape rows_upserted without a DB read.
    import os

    if os.environ.get("WHRB_PIPELINE_RUN_ID"):
        print(
            "[pipeline_summary] "
            f"status={status} rows_upserted={rows_upserted if rows_upserted is not None else ''} "
            f"error={(error or '').replace(chr(10), ' ')[:400]}"
        )
        _fanout_run_complete_notifications(
            run_id, status=status, rows_upserted=rows_upserted, error=error
        )
        return
    try:
        from datetime import datetime

        from supabase import create_client

        client = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])
        patch: dict = {
            "status": status,
            "finished_at": datetime.now(tz=UTC).isoformat(),
        }
        if rows_upserted is not None:
            patch["rows_upserted"] = rows_upserted
        if error:
            patch["error"] = error[:4000]
        client.table("pipeline_runs").update(patch).eq("id", run_id).execute()
    except Exception as e:
        print(f"[pipeline_runs] failed to finalize: {type(e).__name__}: {e}")

    _fanout_run_complete_notifications(
        run_id, status=status, rows_upserted=rows_upserted, error=error
    )


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

    # Start with the default allowlist so a failed source_config bootstrap
    # doesn't accidentally re-enable known-broken scrapers (best_of_boston).
    enabled_sources: set[str] | None = set(ENABLED_SOURCES_DEFAULT)
    if not args.no_supabase:
        try:
            from db import supabase_sync
            supabase_sync.seed_source_config()
            enabled_sources = supabase_sync.read_enabled_sources()
            print(f"[source_config] enabled scrapers: {sorted(enabled_sources)}")
        except Exception as e:
            print(f"[source_config] skipped due to error: {type(e).__name__}: {e}")
            event_log.error(
                "source_config_bootstrap_failed",
                f"source_config bootstrap failed: {type(e).__name__}: {e}",
                context={"exception": type(e).__name__},
            )
            enabled_sources = set(ENABLED_SOURCES_DEFAULT)

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

    # Phase 02 — zip filter + cannabis block + dedupe
    if resume_idx < 1:
        rows = filter_zips(rows)
        # Cannabis filter runs BEFORE dedupe so a blocked licensee can't
        # merge into a legitimate row on address/phone collision (plan §4.5).
        pre_n = len(rows)
        try:
            rows = cannabis_block.filter_rows(rows)
        except cannabis_block.CannabisBlockStale:
            # Fail-closed: every layer down + cache stale > 72h. The
            # event_log already carries an ccc_fetch_stale_fatal entry.
            raise
        dropped = pre_n - len(rows)
        if dropped:
            print(f"[cannabis_block] dropped {dropped} row(s)")
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
        except Exception as e:
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
        # Expand row['tags'] into per-axis CSV columns (plan §4.4).
        _serialize_tags_to_csv(r)

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
    tag_sync_summary: dict | None = None
    tag_sync_error: str | None = None
    if not args.no_supabase:
        try:
            from db import supabase_sync
            print("-- supabase sync --")
            sync_summary = supabase_sync.sync(df.to_dict(orient="records"))
            print(f"[supabase_sync] {sync_summary}")
            checkpoint.save_phase("08_supabase_sync", rows)
        except Exception as e:
            sync_error = f"{type(e).__name__}: {e}"
            print(f"[supabase_sync] FAILED: {sync_error}")
            event_log.error(
                "supabase_sync_aborted",
                f"sync phase aborted: {sync_error}",
                context={"exception": type(e).__name__, "detail": str(e)[:500]},
            )

        # Phase 08_b — tag sync. Always attempted when prospect-sync succeeds;
        # a partial failure caches the emit set for admin retry (plan §4.5).
        if not sync_error:
            _mark_tag_sync_status(run_id, "pending")
            try:
                from db import supabase_sync as _ss
                print("-- tag sync --")
                tag_sync_summary = _ss.tag_sync(rows)
                print(f"[tag_sync] {tag_sync_summary}")
                checkpoint.save_phase("08_b_tag_sync", rows)
                _mark_tag_sync_status(run_id, "ok")
                _clear_last_tag_emit_cache()
            except Exception as e:
                tag_sync_error = f"{type(e).__name__}: {e}"
                print(f"[tag_sync] FAILED: {tag_sync_error}")
                _write_last_tag_emit_cache(rows)
                event_log.error(
                    "tag_sync",
                    f"tag_sync phase aborted: {tag_sync_error}",
                    context={"exception": type(e).__name__, "detail": str(e)[:500]},
                )
                _mark_tag_sync_status(run_id, "failed")

    # run_finish event + pipeline_runs row update
    rows_upserted = None
    if sync_summary:
        rows_upserted = sync_summary.get("inserted", 0) + sync_summary.get("updated", 0)
    status = "success"
    if sync_error or (sync_summary and sync_summary.get("failed", 0) > 0):
        status = "failed"
    if tag_sync_error or (tag_sync_summary and tag_sync_summary.get("failed", 0) > 0):
        status = "failed"
    event_log.info(
        "run_finish",
        f"pipeline run finished ({status})",
        context={
            "rows_written": len(df),
            "sync_summary": sync_summary,
            "tag_sync_summary": tag_sync_summary,
            "status": status,
            "sync_error": sync_error,
            "tag_sync_error": tag_sync_error,
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
