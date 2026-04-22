#!/usr/bin/env python3
"""Apply Stage 10c's 006_pipeline_dispatch_skip_fixtures.sql migration to
WHRB dev.

The SQL replaces the existing `dispatch_pipeline_run()` function with an
updated body that skips rows whose `args` contains `--stage10c-fixture`.
`create or replace function` makes the migration idempotent.

Usage:
    .venv/bin/python scripts/apply_stage10c_followup_migration.py
    .venv/bin/python scripts/apply_stage10c_followup_migration.py --dry-run
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
    REPO_ROOT / "whrb-web" / "supabase" / "migrations" / "006_pipeline_dispatch_skip_fixtures.sql"
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
        f"postgresql://postgres.{project_ref}:{password}@aws-1-us-west-2.pooler.supabase.com:5432/postgres?sslmode=require"
    )
    direct_dsn = (
        f"postgresql://postgres:{password}@db.{project_ref}.supabase.co:5432/postgres?sslmode=require"
    )
    try:
        return psycopg2.connect(pooler_dsn, connect_timeout=10)
    except Exception as e:
        print(
            f"Pooler connection failed ({e.__class__.__name__}): {e}\nFalling back to direct...",
            file=sys.stderr,
        )
        return psycopg2.connect(direct_dsn, connect_timeout=10)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    sql = MIGRATION.read_text()
    print(f"--- applying {MIGRATION.name} ({len(sql):,} bytes) ---")
    if args.dry_run:
        print("(dry-run; not executing)")
        return 0

    conn = _conn_from_env()
    try:
        with conn, conn.cursor() as cur:
            cur.execute(sql)
        print("OK: 006_pipeline_dispatch_skip_fixtures.sql applied.")
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
