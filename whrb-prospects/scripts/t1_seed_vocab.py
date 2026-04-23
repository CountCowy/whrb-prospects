#!/usr/bin/env python3
"""Seed the canonical tag_vocabulary rows from seed_tags.sql.

Used as a standalone re-seed in case someone hard-deletes the seed rows
and wants them back without re-running the full migration. The seed file
itself is `on conflict do nothing`, so this is idempotent.

The trigger `on_rep_tag_vocab_insert` would force any non-admin authed
insert to `pending_admin_review`. We connect via psycopg2 with the
service-role-equivalent direct DB password (auth.uid() is null), so the
trigger no-ops and the canonical seed rows land as `status='active'`.

Usage:
    .venv/bin/python scripts/t1_seed_vocab.py
    .venv/bin/python scripts/t1_seed_vocab.py --dry-run
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
SEED = REPO_ROOT / "whrb-web" / "supabase" / "seed_tags.sql"


def _conn():
    load_dotenv(WHRB_PROSPECTS / ".env")
    project_ref = os.environ.get("SUPABASE_PROJECT_REF")
    password = os.environ.get("SUPABASE_DB_PASSWORD")
    if not project_ref or not password:
        print(
            "ERROR: SUPABASE_PROJECT_REF and SUPABASE_DB_PASSWORD must be set in .env",
            file=sys.stderr,
        )
        sys.exit(2)
    dsn = (
        f"postgresql://postgres:{password}"
        f"@db.{project_ref}.supabase.co:5432/postgres?sslmode=require"
    )
    return psycopg2.connect(dsn, connect_timeout=10)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    sql = SEED.read_text()
    print(f"--- seeding {SEED.name} ({len(sql):,} bytes) ---")
    if args.dry_run:
        print("(dry-run; not executing)")
        return 0

    conn = _conn()
    try:
        with conn, conn.cursor() as cur:
            cur.execute(sql)
            cur.execute(
                "select count(*) from public.tag_vocabulary where status='active'"
            )
            n_active = cur.fetchone()[0]
            cur.execute(
                "select axis, count(*) from public.tag_vocabulary "
                "group by axis order by axis"
            )
            per_axis = cur.fetchall()
        print(f"OK: tag_vocabulary now has {n_active} active rows.")
        for axis, n in per_axis:
            print(f"  {axis:18s} = {n}")
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
