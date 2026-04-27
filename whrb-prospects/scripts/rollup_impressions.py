#!/usr/bin/env python3
"""Stage T4 nightly cron — roll up `filter_impressions` rows older than 30
days into `filter_impression_stats` (week-grain), then delete the raw rows.

Idempotent. Safe to re-run mid-day; same-day re-runs are no-ops because
the source rows older than 30d that have already been rolled up no
longer exist after the first run.

Usage:
    .venv/bin/python scripts/rollup_impressions.py [--dry-run] [--cutoff-days N]
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

import psycopg2
from dotenv import load_dotenv

HERE = Path(__file__).resolve().parent
WHRB_PROSPECTS = HERE.parent


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
    except Exception as e:
        print(
            f"Pooler connection failed ({e.__class__.__name__}): {e}; falling back",
            file=sys.stderr,
        )
        return psycopg2.connect(direct_dsn, connect_timeout=10)


ROLLUP_SQL = """
with eligible as (
  -- Only roll up impressions whose filter_signature was non-default
  -- (matches the `signature like '%=%'` heuristic used by
  -- whrb-web/lib/queries/sources.ts to compute searched_rate).
  -- `filter_impression_stats` has no signature column, so by convention
  -- every row in it represents a non-default impression — that lets the
  -- post-rollup searched_rate query treat all stats rows as "searched"
  -- without re-deriving the heuristic. Default-filter raw rows still
  -- get deleted at the cutoff (the DELETE below is unconditional) —
  -- they just don't carry forward.
  select
    user_id,
    prospect_id,
    date_trunc('week', created_at)::date as week_start,
    count(*) as cnt
  from public.filter_impressions
  where created_at < now() - (%s || ' days')::interval
    and filter_signature is not null
    and filter_signature like '%%=%%'
  group by 1, 2, 3
),
inserted as (
  insert into public.filter_impression_stats
    (user_id, prospect_id, week_start, impression_count)
  select user_id, prospect_id, week_start, cnt from eligible
  on conflict (user_id, prospect_id, week_start)
  do update set impression_count =
    public.filter_impression_stats.impression_count + excluded.impression_count
  returning 1
)
delete from public.filter_impressions
where created_at < now() - (%s || ' days')::interval
returning 1;
"""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument(
        "--cutoff-days",
        type=int,
        default=30,
        help="Roll up rows older than this many days. Default 30.",
    )
    args = ap.parse_args()

    conn = _conn()
    try:
        with conn, conn.cursor() as cur:
            cur.execute(
                "select count(*) from public.filter_impressions "
                "where created_at < now() - (%s || ' days')::interval",
                (str(args.cutoff_days),),
            )
            eligible_count = cur.fetchone()[0]
            print(
                f"[rollup_impressions] eligible raw rows ≥{args.cutoff_days}d: {eligible_count}"
            )
            if args.dry_run:
                print("(dry-run; not rolling up)")
                return 0
            if eligible_count == 0:
                print("[rollup_impressions] nothing to do.")
                return 0
            cur.execute(ROLLUP_SQL, (str(args.cutoff_days), str(args.cutoff_days)))
            deleted = cur.rowcount
            print(f"[rollup_impressions] deleted {deleted} raw rows after rollup.")
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
