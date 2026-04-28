#!/usr/bin/env python3
"""Apply 014_cron_state.sql to WHRB dev (T4 deferred follow-up L7).

Creates the public.cron_state idempotence table, backfills the latest
prune_event_log cursor into it, and deletes the synthetic rows that
prune_event_log.py used to write into pipeline_runs.

Mirrors apply_schedule_fixes_migration.py; safe to re-run.

Usage:
    .venv/bin/python scripts/apply_cron_state_migration.py
    .venv/bin/python scripts/apply_cron_state_migration.py --dry-run
    .venv/bin/python scripts/apply_cron_state_migration.py --rollback
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
REPO_ROOT = WHRB_PROSPECTS.parent

MIGRATION = (
    REPO_ROOT / "whrb-web" / "supabase" / "migrations" / "014_cron_state.sql"
)
ROLLBACK = (
    REPO_ROOT / "whrb-web" / "supabase" / "migrations" / "014_rollback.sql"
)


def _conn_from_env():
    load_dotenv(WHRB_PROSPECTS / ".env")
    project_ref = os.environ.get("SUPABASE_PROJECT_REF")
    password = os.environ.get("SUPABASE_DB_PASSWORD")
    if not project_ref or not password:
        print(
            "ERROR: SUPABASE_PROJECT_REF and SUPABASE_DB_PASSWORD must be set in .env",
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
            f"Pooler connection failed ({e.__class__.__name__}): {e}\n"
            "Falling back to direct...",
            file=sys.stderr,
        )
        return psycopg2.connect(direct_dsn, connect_timeout=10)


def _run(conn, label: str, sql: str, dry_run: bool) -> None:
    print(f"--- {label} ({len(sql):,} bytes) ---")
    if dry_run:
        print("(dry-run; not executing)")
        return
    with conn, conn.cursor() as cur:
        cur.execute(sql)
    print(f"OK: {label} applied.")


def _verify(conn) -> None:
    """Confirm cron_state exists, the policy is in place, and the backfill
    cleaned up the pipeline_runs synthetic rows."""
    with conn, conn.cursor() as cur:
        cur.execute(
            """
            select 1
              from information_schema.tables
             where table_schema='public' and table_name='cron_state'
            """
        )
        if not cur.fetchone():
            print("WARNING: public.cron_state missing post-migration.", file=sys.stderr)
            return
        print("table OK: public.cron_state present.")

        cur.execute(
            """
            select 1
              from pg_policies
             where schemaname='public'
               and tablename='cron_state'
               and policyname='p_cron_state_read'
            """
        )
        if cur.fetchone():
            print("RLS OK: p_cron_state_read present.")
        else:
            print("WARNING: p_cron_state_read missing.", file=sys.stderr)

        cur.execute(
            "select count(*) from public.pipeline_runs where args like 'prune_event_log:%'"
        )
        residual = cur.fetchone()[0]
        if residual == 0:
            print("backfill OK: zero synthetic prune_event_log rows in pipeline_runs.")
        else:
            print(
                f"WARNING: {residual} synthetic prune_event_log rows remain in pipeline_runs.",
                file=sys.stderr,
            )

        cur.execute(
            "select key, last_run_at from public.cron_state where key='prune_event_log'"
        )
        row = cur.fetchone()
        if row:
            print(f"backfill cursor: prune_event_log last_run_at = {row[1]}")
        else:
            print(
                "(no prune_event_log cursor in cron_state — first run will create it)"
            )


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument(
        "--rollback",
        action="store_true",
        help="Apply 014_rollback.sql instead of 014_cron_state.sql.",
    )
    args = ap.parse_args()

    target = ROLLBACK if args.rollback else MIGRATION
    conn = _conn_from_env()
    try:
        _run(conn, target.name, target.read_text(), args.dry_run)
        if not args.dry_run and not args.rollback:
            _verify(conn)
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
