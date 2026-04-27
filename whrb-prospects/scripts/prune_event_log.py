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

Idempotent. Same-day re-runs are no-ops via a prune-cursor row stashed
in pipeline_runs (we abuse the audit table by writing a synthetic row
keyed off `args = 'prune_event_log:<YYYY-MM-DD>'`).
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
        "--cursor-key",
        default=None,
        help="Override prune cursor (default: today's UTC date).",
    )
    args = ap.parse_args()

    cursor_key = args.cursor_key or dt.datetime.now(tz=dt.UTC).strftime(
        "prune_event_log:%Y-%m-%d"
    )

    conn = _conn()
    total = 0
    try:
        with conn, conn.cursor() as cur:
            # Idempotence guard.
            cur.execute(
                "select 1 from public.pipeline_runs where args = %s limit 1",
                (cursor_key,),
            )
            if cur.fetchone() is not None:
                print(
                    f"[prune_event_log] cursor {cursor_key} already ran today — "
                    "no-op."
                )
                return 0
            if args.dry_run:
                print(f"[prune_event_log] (dry-run; cursor would be {cursor_key})")
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

            # Stamp cursor row.
            cur.execute(
                """
                insert into public.pipeline_runs (status, args, started_at, finished_at)
                values ('success', %s, now(), now())
                """,
                (cursor_key,),
            )
            print(
                f"[prune_event_log] {total} rows deleted (rolled into event_log_stats);"
                f" cursor stamped: {cursor_key}"
            )
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
