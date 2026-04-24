#!/usr/bin/env python3
"""Stage T2 cleanup — undo the t2_plant fixtures.

Order:
  1. delete prospect_tags for fixture prospects + the T1 locked-tag row.
  2. delete fixture prospects.
  3. restore data/ccc_manual_blocklist.txt to its pre-plant contents by
     removing the marker-wrapped block t2_plant.py appended.
  4. delete the synthetic T2 rep (profiles cascades from auth.users).
  5. prune event_log rows in T2-introduced categories.
  6. delete the snapshot file.

Idempotent: missing rows are tolerated.
"""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

HERE = Path(__file__).resolve().parent
WHRB = HERE.parent
sys.path.insert(0, str(WHRB))
load_dotenv(WHRB / ".env")

SUPABASE_URL = os.environ["SUPABASE_URL"]
SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

SNAPSHOT_PATH = WHRB / "cache" / "t2_snapshot.json"
OVERLAY_PATH = WHRB / "data" / "ccc_manual_blocklist.txt"
REP_EMAIL = "t2-rep@example.com"

# Stage-T2 event categories we emit + should prune for the next re-run.
T2_EVENT_CATEGORIES = [
    "cannabis_blocked",
    "ccc_fetch_failed",
    "ccc_load",
    "tag_vocab_miss",
    "tag_vocab_miss_threshold",
    "tag_sync",
    "compliance_resuppressed",
    "tag_suppressed",
    "vocab_archived",
]

# Literal ``company_name`` values planted by t2_plant.py — used for cleanup
# when the snapshot is missing. The business_key format changed to match
# db.supabase_sync.business_key() (``name:<norm>|<zip>``), so we match by
# ``company_name`` equality rather than a key prefix.
T2_FIXTURE_NAMES = (
    "T2 Fixture CCC Match",
    "T2 Indica Lounge",
    "T2 Address Twin Gallery",
    "T2 OSM Cannabis",
    "T2 Clean Prospect A",
    "T2 Clean Prospect B",
)


def _client():
    return create_client(SUPABASE_URL, SERVICE_KEY)


def _unwrap_overlay(marker: str) -> None:
    """Remove the marker-wrapped block t2_plant.py appended."""
    if not OVERLAY_PATH.exists():
        return
    text = OVERLAY_PATH.read_text(encoding="utf-8")
    # Remove every block that matches `\n<marker>\n...\n<marker>\n`.
    pattern = re.compile(
        r"\n" + re.escape(marker) + r"\n.*?\n" + re.escape(marker) + r"\n",
        re.DOTALL,
    )
    cleaned = pattern.sub("", text)
    if cleaned != text:
        OVERLAY_PATH.write_text(cleaned, encoding="utf-8")
        print(f"Restored {OVERLAY_PATH} to pre-plant contents.")


def main() -> int:
    sb = _client()

    snapshot: dict = {}
    if SNAPSHOT_PATH.exists():
        snapshot = json.loads(SNAPSHOT_PATH.read_text())

    # Identify fixture prospects by literal company_name (snapshot-free path).
    fp_rows = (
        sb.table("prospects")
        .select("id,company_name")
        .in_("company_name", list(T2_FIXTURE_NAMES))
        .execute()
        .data
        or []
    )
    fixture_ids = [r["id"] for r in fp_rows]

    # 1) Delete T2 fixture prospect_tags + the T1 locked-tag plant.
    if fixture_ids:
        sb.table("prospect_tags").delete().in_("prospect_id", fixture_ids).execute()
    locked_tag_row_id = snapshot.get("locked_tag_row_id")
    if locked_tag_row_id:
        sb.table("prospect_tags").delete().eq("id", locked_tag_row_id).execute()

    # 2) Delete fixture prospects.
    for pid in fixture_ids:
        sb.table("prospects").delete().eq("id", pid).execute()
    if fixture_ids:
        print(f"Deleted {len(fixture_ids)} fixture prospects.")

    # 3) Restore overlay.
    marker = snapshot.get("overlay_marker") or "# --- T2 PLANT OVERLAY (auto-added; removed on cleanup) ---"
    _unwrap_overlay(marker)

    # 4) Delete synthetic T2 rep.
    rep_id = snapshot.get("rep_id")
    if not rep_id:
        rep = (
            sb.table("profiles")
            .select("id")
            .eq("email", REP_EMAIL)
            .execute()
            .data
        )
        rep_id = rep[0]["id"] if rep else None
    if rep_id:
        try:
            sb.auth.admin.delete_user(rep_id)
            print(f"Deleted synthetic T2 rep {rep_id}.")
        except Exception as e:
            print(f"(rep delete tolerated) {e}")

    # 5) Prune T2-introduced event_log categories.
    sb.table("event_log").delete().in_("category", T2_EVENT_CATEGORIES).execute()

    # 6) Drop snapshot.
    if SNAPSHOT_PATH.exists():
        SNAPSHOT_PATH.unlink()
        print(f"Removed snapshot {SNAPSHOT_PATH}.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
