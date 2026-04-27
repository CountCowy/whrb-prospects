#!/usr/bin/env python3
"""Stage T4 nightly cron — auto-promote source_config rows through the
lifecycle.

  sunset_proposed → sunset    at  >= 15 days since status_changed_at
  sunset          → archived  at  >= 30 days since status_changed_at
                              (45 days total from initial proposal)

Emits one event_log row per promotion: `source_sunset_auto` or
`source_archived_auto`, with `context = {source, rows_at_sunset?,
close_rate_at_sunset?}` (best-effort).

Idempotent. Re-running the same day is a no-op because the second pass
finds zero rows newly past the cutoff.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import psycopg2
import psycopg2.extras
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
    except Exception:
        return psycopg2.connect(direct_dsn, connect_timeout=10)


def _promote(cur, *, from_status: str, to_status: str, age_days: int, event_category: str) -> int:
    cur.execute(
        """
        select source_key from public.source_config
        where status = %s
          and status_changed_at < now() - (%s || ' days')::interval
        """,
        (from_status, str(age_days)),
    )
    rows = [r[0] for r in cur.fetchall()]
    if not rows:
        return 0
    for source_key in rows:
        # Best-effort context: rows attributed to this source + close-rate
        # snapshot at sunset.
        #
        # Match the comma-joined `prospects.source` field at array-membership
        # precision via `string_to_array(...) @> ARRAY[%s]`. The previous
        # `like '%key%'` form would over-match if a future source_key was a
        # substring of another (e.g. `osm` of `osm_extra`).
        cur.execute(
            """
            select count(*) filter (where state in ('sold','ongoing_contact'))::float
                   / nullif(count(*),0) as close_rate,
                   count(*) as rows
            from public.prospects
            where string_to_array(source, ',') @> ARRAY[%s]
            """,
            (source_key,),
        )
        result = cur.fetchone()
        close_rate, rows_at_sunset = result if result else (None, None)
        cur.execute(
            "update public.source_config set status = %s where source_key = %s",
            (to_status, source_key),
        )
        cur.execute(
            """
            insert into public.event_log
              (source, level, category, message, context)
            values (%s, %s, %s, %s, %s::jsonb)
            """,
            (
                "pipeline",
                "info",
                event_category,
                f"{event_category}: {source_key} {from_status}→{to_status}",
                json.dumps(
                    {
                        "source": source_key,
                        "from_status": from_status,
                        "to_status": to_status,
                        "rows_at_sunset": rows_at_sunset,
                        "close_rate_at_sunset": close_rate,
                    }
                ),
            ),
        )
    return len(rows)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    conn = _conn()
    try:
        with conn, conn.cursor() as cur:
            if args.dry_run:
                cur.execute(
                    """
                    select source_key,
                           status_changed_at < now() - interval '15 days' as ready_to_sunset,
                           status,
                           status_changed_at
                    from public.source_config
                    where status in ('sunset_proposed','sunset')
                    order by status_changed_at
                    """
                )
                for row in cur.fetchall():
                    print(row)
                return 0
            promoted_to_sunset = _promote(
                cur,
                from_status="sunset_proposed",
                to_status="sunset",
                age_days=15,
                event_category="source_sunset_auto",
            )
            promoted_to_archived = _promote(
                cur,
                from_status="sunset",
                to_status="archived",
                age_days=30,
                event_category="source_archived_auto",
            )
            print(
                f"[advance_source_lifecycle] sunset_proposed→sunset: {promoted_to_sunset};"
                f" sunset→archived: {promoted_to_archived}"
            )
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
