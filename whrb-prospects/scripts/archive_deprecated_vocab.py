#!/usr/bin/env python3
"""Nightly archive pass over deprecated tag_vocabulary rows (plan §4.4).

Hard-deletes ``tag_vocabulary`` rows that have been ``status='deprecated'``
for > 12 months AND have zero ``prospect_tags`` FK references. Every
archive action emits ``event_log.category='vocab_archived'`` so admins
can audit the trickle.

Intended to run as a cron via the same `scheduled-tasks` surface the
nightly pipeline uses. Safe to run manually:

    .venv/bin/python scripts/archive_deprecated_vocab.py
    .venv/bin/python scripts/archive_deprecated_vocab.py --dry-run

Returns 0 always — this is maintenance, not a gate.
"""
from __future__ import annotations

import argparse
import os
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

HERE = Path(__file__).resolve().parent
WHRB = HERE.parent
sys.path.insert(0, str(WHRB))
load_dotenv(WHRB / ".env")

from util import event_log


def _client():
    return create_client(
        os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    )


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument(
        "--age-months",
        type=int,
        default=12,
        help="Deprecation-age threshold in months (default 12).",
    )
    args = ap.parse_args()

    sb = _client()
    cutoff = (datetime.now(tz=UTC) - timedelta(days=30 * args.age_months)).isoformat()

    # Candidates: deprecated vocab older than the cutoff.
    cand = (
        sb.table("tag_vocabulary")
        .select("id,axis,value,updated_at")
        .eq("status", "deprecated")
        .lt("updated_at", cutoff)
        .execute()
        .data
        or []
    )
    if not cand:
        print("No archive candidates.")
        return 0

    # Filter to the subset with zero prospect_tags references.
    archive_ids: list[dict] = []
    for row in cand:
        refs = (
            sb.table("prospect_tags")
            .select("id", count="exact", head=True)
            .eq("tag_id", row["id"])
            .execute()
        )
        if (refs.count or 0) == 0:
            archive_ids.append(row)

    print(f"Archive candidates: {len(cand)}; unreferenced: {len(archive_ids)}")
    for row in archive_ids:
        if args.dry_run:
            print(f"(dry-run) would archive {row['axis']}:{row['value']} ({row['id']})")
            continue
        sb.table("tag_vocabulary").delete().eq("id", row["id"]).execute()
        event_log.info(
            "vocab_archived",
            f"archived deprecated vocab {row['axis']}:{row['value']}",
            context={
                "id": row["id"],
                "axis": row["axis"],
                "value": row["value"],
                "deprecated_since": row["updated_at"],
            },
        )
        print(f"archived {row['axis']}:{row['value']} ({row['id']})")
    event_log.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
