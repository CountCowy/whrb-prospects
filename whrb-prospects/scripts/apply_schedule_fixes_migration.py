#!/usr/bin/env python3
"""Apply 013_schedule_fixes.sql to WHRB dev (post-012 schedule review fixes).

Re-shapes the imported-event unique index to be per-feed and adds a
tripwire CHECK on `schedule_event_reminders.fire_at`. Mirrors the
apply_schedule_migration.py pattern; safe to re-run.

Usage:
    .venv/bin/python scripts/apply_schedule_fixes_migration.py
    .venv/bin/python scripts/apply_schedule_fixes_migration.py --dry-run
    .venv/bin/python scripts/apply_schedule_fixes_migration.py --rollback
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
    REPO_ROOT / "whrb-web" / "supabase" / "migrations" / "013_schedule_fixes.sql"
)
ROLLBACK = (
    REPO_ROOT / "whrb-web" / "supabase" / "migrations" / "013_rollback.sql"
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
    """Confirm the per-feed unique index and the fire_at CHECK both exist."""
    with conn, conn.cursor() as cur:
        cur.execute(
            """
            select indexdef
              from pg_indexes
             where schemaname = 'public'
               and indexname = 'idx_sched_external_unique'
            """
        )
        row = cur.fetchone()
        if not row:
            print(
                "WARNING: idx_sched_external_unique missing post-migration.",
                file=sys.stderr,
            )
            return
        indexdef = row[0]
        if "external_calendar_id" in indexdef:
            print(f"index OK (per-feed): {indexdef}")
        else:
            print(
                f"WARNING: index still global, not per-feed: {indexdef}",
                file=sys.stderr,
            )

        cur.execute(
            """
            select 1
              from pg_constraint
             where conname = 'sched_reminder_fire_at_tripwire'
               and conrelid = 'public.schedule_event_reminders'::regclass
            """
        )
        if cur.fetchone():
            print("CHECK OK: sched_reminder_fire_at_tripwire present.")
        else:
            print(
                "WARNING: sched_reminder_fire_at_tripwire missing post-migration.",
                file=sys.stderr,
            )


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument(
        "--rollback",
        action="store_true",
        help="Apply 013_rollback.sql instead of 013_schedule_fixes.sql.",
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
