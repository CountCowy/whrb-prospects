#!/usr/bin/env python3
"""Stage T4 nightly cron — enforce event_log retention buckets and roll
deleted rows into `event_log_stats` (week-grain) for indefinite trend
tracking.

Buckets (per plan §1.3 #26):
  - level IN ('error','fatal'): 6 months
  - category IN ('prospect_change','prospect_tag_change'): 6 months
  - instrumentation categories: 3 months
  - category LIKE 'pipeline\\_%%' escape '\\': 90 days
  - everything else: 90 days

Idempotent. Same-day re-runs are no-ops via the public.cron_state table
(migration 014_cron_state.sql) keyed off CRON_KEY. Older builds of this
script stashed the cursor in pipeline_runs as a synthetic row; that
hack is gone — 014 backfills the latest cursor into cron_state and
deletes the synthetic rows.
"""
from __future__ import annotations

import argparse
import datetime as dt
import os
import sys
from pathlib import Path

import psycopg2
from dotenv import load_dotenv

HERE = Path(__file__).resolve().parent
WHRB_PROSPECTS = HERE.parent

CRON_KEY = "prune_event_log"

INSTRUMENTATION_CATEGORIES = (
    "dedupe_match",
    "tag_sync",
    "tag_vocab_miss",
    "tag_lock_skip",
    "peer_station_skip",
    "cannabis_blocked",
    "ccc_fetch_failed",
    "vocab_archived",
    "compliance_cleared",
    "compliance_resuppressed",
    "vocab_axis_changed",
    "source_sunset_auto",
    "source_archived_auto",
    "source_lifecycle_reversed",
    "source_sunset_proposed",
    "tag_removed_by_other",
    "vocab_digest_summary",
)


def _conn():
    load_dotenv(WHRB_PROSPECTS / ".env")
    project_ref = os.environ.get("SUPABASE_PROJECT_REF")
    password = os.environ.get("SUPABASE_DB_PASSWORD")
    if not project_ref or not password:
        print(
            "ERROR: SUPABASE_PROJECT_REF and SUPABASE_DB_PASSWORD must be set",
            file=sys.stderr,
        )
        sys.exit(2)
    pooler_dsn = (
        f"postgresql://postgres.{project_ref}:{password}"
        "@aws-1-us-west-2.pooler.supabase.com:5432/postgres?sslmode=require"
    )
    direct_dsn = (
        f"postgresql://postgres:{password}"
        f"@db.{project_ref}.supabase.co:5432/postgres?sslmode=require"
    )
    try:
        return psycopg2.connect(pooler_dsn, connect_timeout=10)
    except Exception:
        return psycopg2.connect(direct_dsn, connect_timeout=10)


def _aggregate_then_delete(cur, where_clause: str, params: tuple, label: str) -> int:
    """Roll qualifying rows into event_log_stats then delete them.

    NOTE: any literal `%` in the SQL must be escaped as `%%` because
    psycopg2 parses the format string for `%(name)s` / `%s` placeholders.
    Callers writing `category like 'pipeline\\_%%' escape '\\'` must use `pipeline_%%`.
    """
    cur.execute(
        f"""
        with rolled as (
          select
            date_trunc('week', created_at)::date as week_start,
            category,
            level,
            count(*) as cnt
          from public.event_log
          where {where_clause}
          group by 1, 2, 3
        ),
        upserted as (
          insert into public.event_log_stats (week_start, category, level, count)
          select week_start, coalesce(category, '__none__'), level, cnt from rolled
          on conflict (week_start, category, level)
          do update set count = public.event_log_stats.count + excluded.count
          returning 1
        )
        delete from public.event_log
        where {where_clause}
        returning 1;
        """,
        params + params,
    )
    deleted = cur.rowcount
    print(f"[prune_event_log] {label}: deleted {deleted}")
    return deleted


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument(
        "--force",
        action="store_true",
        help="Skip the same-day idempotence guard and run anyway.",
    )
    args = ap.parse_args()

    today = dt.datetime.now(tz=dt.UTC).date()

    conn = _conn()
    total = 0
    try:
        with conn, conn.cursor() as cur:
            # Idempotence guard via cron_state. The table is created by
            # 014_cron_state.sql; if it doesn't exist (e.g. running an
            # unmigrated dev DB), the script hard-errors with a clear
            # message rather than silently skipping the guard.
            cur.execute(
                """
                select (last_run_at at time zone 'utc')::date
                  from public.cron_state
                 where key = %s
                """,
                (CRON_KEY,),
            )
            row = cur.fetchone()
            last_run_date = row[0] if row else None
            if last_run_date == today and not args.force:
                print(
                    f"[prune_event_log] cron_state[{CRON_KEY}].last_run_at "
                    f"is {last_run_date} (today, UTC) — no-op. Pass --force "
                    "to override."
                )
                return 0
            if args.dry_run:
                print(
                    f"[prune_event_log] (dry-run; would stamp cron_state[{CRON_KEY}] "
                    f"for {today})"
                )
                return 0

            # 1) errors/fatal/audit categories: 6 months.
            total += _aggregate_then_delete(
                cur,
                "(level in ('error','fatal') "
                "or category in ('prospect_change','prospect_tag_change')) "
                "and created_at < now() - interval '180 days'",
                tuple(),
                "errors+audit ≥180d",
            )

            # 2) instrumentation categories: 3 months.
            in_clause = ",".join(["%s"] * len(INSTRUMENTATION_CATEGORIES))
            total += _aggregate_then_delete(
                cur,
                f"category in ({in_clause}) and created_at < now() - interval '90 days'",
                INSTRUMENTATION_CATEGORIES,
                "instrumentation ≥90d",
            )

            # 3) pipeline_% debug: 90 days. Escape the underscore so the LIKE
            # pattern matches a literal `pipeline_<word>` and does NOT match
            # categories that happen to start with `pipelineX...` (a bare `_`
            # is a single-char wildcard).
            total += _aggregate_then_delete(
                cur,
                "category like 'pipeline\\_%%' escape '\\' "
                "and created_at < now() - interval '90 days'",
                tuple(),
                "pipeline debug ≥90d",
            )

            # 4) everything else: 90 days. Excluding the buckets above.
            # NULL-safe on `level`: `level not in (...)` is null for NULL
            # rows, which evaluates to false-not-true and would let
            # null-level rows leak past retention indefinitely. Wrap in
            # `(level is null or level not in (...))` so they fall into the
            # default bucket like every other low-priority row.
            total += _aggregate_then_delete(
                cur,
                "(category is null or "
                f"(category not in ({in_clause}) "
                "and category not in ('prospect_change','prospect_tag_change') "
                "and category not like 'pipeline\\_%%' escape '\\')) "
                "and (level is null or level not in ('error','fatal')) "
                "and created_at < now() - interval '90 days'",
                INSTRUMENTATION_CATEGORIES,
                "default ≥90d",
            )

            # Stamp the cursor. UPSERT so the first ever run after the
            # 014 migration creates the row; subsequent runs update it.
            cur.execute(
                """
                insert into public.cron_state (key, last_run_at)
                values (%s, now())
                on conflict (key) do update
                  set last_run_at = excluded.last_run_at
                """,
                (CRON_KEY,),
            )
            print(
                f"[prune_event_log] {total} rows deleted (rolled into event_log_stats);"
                f" cron_state[{CRON_KEY}] stamped {today}"
            )
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
