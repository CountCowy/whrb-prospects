#!/usr/bin/env python3
"""Apply Stage T5's 015_peer_stations.sql migration to WHRB dev.

Mirrors apply_t4_migration.py. The DDL uses ``create table if not exists`` /
``create policy``-with-`drop policy if exists` / ``insert ... on conflict do
nothing`` everywhere, so this script is safe to re-run.

Usage:
    .venv/bin/python scripts/apply_t5_migration.py
    .venv/bin/python scripts/apply_t5_migration.py --dry-run
    .venv/bin/python scripts/apply_t5_migration.py --rollback
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
    REPO_ROOT / "whrb-web" / "supabase" / "migrations" / "015_peer_stations.sql"
)
ROLLBACK = (
    REPO_ROOT / "whrb-web" / "supabase" / "migrations" / "015_rollback.sql"
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


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument(
        "--rollback",
        action="store_true",
        help="Apply 015_rollback.sql instead of 015_peer_stations.sql.",
    )
    args = ap.parse_args()

    if args.rollback:
        sql = ROLLBACK.read_text()
        conn = _conn_from_env()
        try:
            _run(conn, ROLLBACK.name, sql, args.dry_run)
        finally:
            conn.close()
        return 0

    conn = _conn_from_env()
    try:
        _run(conn, MIGRATION.name, MIGRATION.read_text(), args.dry_run)
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
