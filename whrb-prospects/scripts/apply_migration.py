#!/usr/bin/env python3
"""Apply the WHRB-prospects schema migration + seed against Supabase Postgres.

Uses a direct Postgres connection (psycopg2) with credentials from
whrb-prospects/.env. The service-role REST API cannot issue arbitrary DDL,
so we go straight to Postgres.

Usage:
    python scripts/apply_migration.py                 # schema + seed
    python scripts/apply_migration.py --schema-only
    python scripts/apply_migration.py --seed-only
    python scripts/apply_migration.py --dry-run       # parse + print, no exec

The script is idempotent for seed.sql (ON CONFLICT / no-op UPDATE). For
000_init.sql it is NOT idempotent — re-running against a populated project
will fail on duplicate `create table`. That's fine for Stage 1 (project is
empty). If you need to re-apply, drop the `public` schema first or use a
proper migration chain (future work).
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

MIGRATION_SQL = REPO_ROOT / "whrb-web" / "supabase" / "migrations" / "000_init.sql"
SEED_SQL = REPO_ROOT / "whrb-web" / "supabase" / "seed.sql"


def _conn_from_env():
    load_dotenv(WHRB_PROSPECTS / ".env")
    project_ref = os.environ.get("SUPABASE_PROJECT_REF")
    password = os.environ.get("SUPABASE_DB_PASSWORD")
    if not project_ref or not password:
        print("ERROR: SUPABASE_PROJECT_REF and SUPABASE_DB_PASSWORD must be set in .env", file=sys.stderr)
        sys.exit(2)
    # Prefer direct connection; fall back to pooler if direct fails (IPv4-only networks).
    direct_dsn = f"postgresql://postgres:{password}@db.{project_ref}.supabase.co:5432/postgres?sslmode=require"
    pooler_dsn = f"postgresql://postgres.{project_ref}:{password}@aws-0-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require"
    try:
        return psycopg2.connect(direct_dsn, connect_timeout=10)
    except Exception as e:
        print(f"Direct connection failed ({e.__class__.__name__}): {e}\nFalling back to pooler...", file=sys.stderr)
        return psycopg2.connect(pooler_dsn, connect_timeout=10)


def _apply(conn, path: Path, label: str, dry_run: bool) -> None:
    sql = path.read_text()
    print(f"--- {label}: {path.name} ({len(sql):,} bytes) ---")
    if dry_run:
        print("(dry-run; not executing)")
        return
    with conn, conn.cursor() as cur:
        cur.execute(sql)
    print(f"OK: {label} applied.")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--schema-only", action="store_true")
    ap.add_argument("--seed-only", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if args.schema_only and args.seed_only:
        print("--schema-only and --seed-only are mutually exclusive", file=sys.stderr)
        return 2

    conn = _conn_from_env()
    try:
        if not args.seed_only:
            _apply(conn, MIGRATION_SQL, "schema", args.dry_run)
        if not args.schema_only:
            _apply(conn, SEED_SQL, "seed", args.dry_run)
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
