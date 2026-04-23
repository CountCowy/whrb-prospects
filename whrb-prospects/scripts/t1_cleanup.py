#!/usr/bin/env python3
"""Stage T1 cleanup — undo the t1_plant fixtures.

Order matters because of FK cascades:
  1. delete prospect_tags for the fixture prospect (cascades on prospect
     delete, but we do it first to keep audit-trigger noise localised).
  2. delete the fixture prospect.
  3. delete any t1-prefixed fixture vocab rows the integrity run created.
  4. delete the synthetic rep auth user (profiles row cascades).
  5. delete the snapshot file.

Cleanup also pre-deletes any `tag_vocab_pending` notifications targeting
the admin that were created by the integrity-run rep INSERTs (T05),
plus any T1-emitted event_log rows for the fixture prospect, so a
re-run of t1_plant + integrity starts from a clean event tail.

Idempotent: missing rows are skipped silently.
"""
from __future__ import annotations

import json
import os
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

SNAPSHOT_PATH = WHRB / "cache" / "t1_snapshot.json"
REP_EMAIL = "t1-rep@example.com"
FIXTURE_PROSPECT_KEY = "t1-fixture-merge-prospect"

# Vocab values used inside the integrity run — pre-deleted on cleanup so
# a fresh run starts clean even if integrity exited halfway.
INTEGRITY_VOCAB_VALUES = [
    "jazzfixture",
    "jazzfixture_renamed",
    "t1_merge_source",
    "t1_merge_target",
    "t1_axis_change_src",
    "t1_axis_change_other",
    "t1_admin_active_seed",
    "t1_rep_pending_seed",
    "t1_deprecate_src",
    "t1_deprecate_repl",
]


def _client():
    return create_client(SUPABASE_URL, SERVICE_KEY)


def main() -> int:
    sb = _client()

    # 1) Resolve fixture prospect id (snapshot may not exist if cleanup is
    #    being run after a full plant+integrity cycle).
    snapshot = {}
    if SNAPSHOT_PATH.exists():
        snapshot = json.loads(SNAPSHOT_PATH.read_text())
    prospect_id = snapshot.get("prospect_id")
    if not prospect_id:
        fp = (
            sb.table("prospects")
            .select("id")
            .eq("business_key", FIXTURE_PROSPECT_KEY)
            .execute()
        )
        prospect_id = fp.data[0]["id"] if fp.data else None

    rep_id = snapshot.get("rep_id")
    if not rep_id:
        rp = (
            sb.table("profiles")
            .select("id")
            .eq("email", REP_EMAIL)
            .execute()
        )
        rep_id = rp.data[0]["id"] if rp.data else None

    # 2) Delete integrity-run vocab rows (may have prospect_tags pointing at
    #    them; delete those first).
    vocab_rows = (
        sb.table("tag_vocabulary")
        .select("id,value")
        .in_("value", INTEGRITY_VOCAB_VALUES)
        .execute()
    )
    vocab_ids = [r["id"] for r in (vocab_rows.data or [])]
    if vocab_ids:
        (
            sb.table("prospect_tags")
            .delete()
            .in_("tag_id", vocab_ids)
            .execute()
        )
        sb.table("tag_vocabulary").delete().in_("id", vocab_ids).execute()
        print(f"Deleted {len(vocab_ids)} integrity-run vocab rows.")

    # 3) Delete fixture prospect (cascades prospect_tags, prospect_notes,
    #    prospect_presence; emits state-change audit but we tolerate).
    if prospect_id:
        sb.table("prospects").delete().eq("id", prospect_id).execute()
        print(f"Deleted fixture prospect {prospect_id}.")

    # 4) Delete any tag_vocab_pending notifications targeting the admin
    #    that were emitted by the integrity-run rep INSERTs.
    sb.table("notifications").delete().eq("kind", "tag_vocab_pending").execute()

    # 5) Delete event_log noise emitted during the integrity run for the
    #    fixture prospect / rep / vocab rows. Conservative: only categories
    #    introduced by T1.
    sb.table("event_log").delete().in_(
        "category",
        [
            "vocab_created",
            "vocab_updated",
            "vocab_axis_changed",
            "vocab_deleted",
            "tag_merge",
            "prospect_tag_added",
            "prospect_tag_removed",
        ],
    ).execute()

    # 6) Delete the synthetic rep (profiles cascades from auth.users).
    if rep_id:
        try:
            sb.auth.admin.delete_user(rep_id)
            print(f"Deleted synthetic rep {rep_id}.")
        except Exception as e:
            print(f"(rep delete tolerated, may already be gone) {e}")

    if SNAPSHOT_PATH.exists():
        SNAPSHOT_PATH.unlink()
        print(f"Removed snapshot {SNAPSHOT_PATH}.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
