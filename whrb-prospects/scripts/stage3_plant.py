#!/usr/bin/env python3
"""Stage 3 plant + pre-snapshot helper.

Runs once, BEFORE the first Stage 3 rerun. Captures everything the
integrity script needs later:

  * stage3_start_time        — ISO timestamp used to scope event_log queries.
  * pre_row_count            — total rows in public.prospects before planting.
  * pre_distinct_bk          — distinct business_key count before planting.
  * created_at_map           — {id -> created_at} for every pre-existing row,
                                so the integrity script can assert "upsert,
                                not re-insert" (Stage 3 test 4).
  * lock_test_row            — {id, business_key, original_company_phone}
                                The row's company_phone is set to
                                '555-TEST-LOCK' and user_overrides locks it.
  * unlock_test_row          — {id, business_key, original_company_phone}
                                company_phone set to '999-FAKE-UNLOCK',
                                user_overrides left empty so the pipeline
                                rerun should snap it back.
  * synthetic_row            — {id, business_key, pipeline_last_seen_at}
                                Freshly inserted row with a business_key the
                                pipeline will never derive (so
                                pipeline_last_seen_at must remain unchanged).

The snapshot is written to ``cache/stage3_snapshot.json``; the integrity
script reads it back.
"""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

HERE = Path(__file__).resolve().parent
WHRB = HERE.parent
sys.path.insert(0, str(WHRB))
load_dotenv(WHRB / ".env")

SUPABASE_URL = os.environ["SUPABASE_URL"]
SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

SNAPSHOT_PATH = WHRB / "cache" / "stage3_snapshot.json"

LOCK_PHONE = "555-TEST-LOCK"
UNLOCK_PHONE = "999-FAKE-UNLOCK"
SYNTHETIC_BK = "synthetic-test-001"


def _select_all(client, table: str, columns: str):
    out: list[dict] = []
    start = 0
    page = 1000
    while True:
        res = (
            client.table(table)
            .select(columns)
            .range(start, start + page - 1)
            .execute()
        )
        batch = res.data or []
        out.extend(batch)
        if len(batch) < page:
            break
        start += page
    return out


def main() -> int:
    client = create_client(SUPABASE_URL, SERVICE_KEY)

    stage3_start = datetime.now(tz=timezone.utc).isoformat()
    print(f"[plant] stage3 start time: {stage3_start}")

    # ---- baseline counts + created_at snapshot ----
    rows = _select_all(
        client,
        "prospects",
        "id,business_key,created_at,company_phone,created_source",
    )
    pre_count = len(rows)
    distinct = len({r["business_key"] for r in rows})
    created_at_map = {r["id"]: r["created_at"] for r in rows}
    print(f"[plant] baseline: rows={pre_count} distinct_bk={distinct}")

    # ---- pick lock + unlock target rows ----
    # Requirements: created_source='pipeline', non-null company_phone, not the
    # NETKILL simulation residue, and *two distinct* rows. business_key prefix
    # 'phone:' guarantees the pipeline will have company_phone on rerun so the
    # unlock snap-back is observable.
    candidates = [
        r for r in rows
        if r.get("created_source") == "pipeline"
        and r.get("company_phone")
        and r.get("business_key", "").startswith("phone:")
        and not (r.get("business_key") or "").startswith("phone:555010")
    ]
    if len(candidates) < 2:
        print("[plant] FATAL: fewer than 2 suitable candidate rows", file=sys.stderr)
        return 1
    lock_target, unlock_target = candidates[0], candidates[1]

    # --- Apply lock + unlock edits in a single UPDATE each ---
    client.table("prospects").update({
        "company_phone": LOCK_PHONE,
        "user_overrides": {"company_phone": True},
    }).eq("id", lock_target["id"]).execute()
    print(
        f"[plant] lock row id={lock_target['id']} bk={lock_target['business_key']} "
        f"orig_phone={lock_target['company_phone']!r} -> {LOCK_PHONE!r} (locked)"
    )

    client.table("prospects").update({
        "company_phone": UNLOCK_PHONE,
        "user_overrides": {},
    }).eq("id", unlock_target["id"]).execute()
    print(
        f"[plant] unlock row id={unlock_target['id']} bk={unlock_target['business_key']} "
        f"orig_phone={unlock_target['company_phone']!r} -> {UNLOCK_PHONE!r} (unlocked)"
    )

    # ---- synthesize a row the pipeline will never touch ----
    old_seen = (datetime.now(tz=timezone.utc) - timedelta(days=2)).isoformat()
    # delete any residue from a prior plant run so this is idempotent
    client.table("prospects").delete().eq("business_key", SYNTHETIC_BK).execute()
    syn_res = client.table("prospects").insert({
        "business_key": SYNTHETIC_BK,
        "company_name": "Stage3 Synthetic Test 001",
        "created_source": "pipeline",
        "tier": "C",
        "state": "researching",
        "priority_score": 1,
        "pipeline_last_seen_at": old_seen,
    }).execute()
    syn_id = (syn_res.data or [{}])[0].get("id")
    print(f"[plant] synthetic row id={syn_id} bk={SYNTHETIC_BK} seen={old_seen}")

    snapshot = {
        "stage3_start_time": stage3_start,
        "pre_row_count": pre_count,
        "pre_distinct_bk": distinct,
        "created_at_map": created_at_map,
        "lock_test_row": {
            "id": lock_target["id"],
            "business_key": lock_target["business_key"],
            "original_company_phone": lock_target["company_phone"],
            "planted_phone": LOCK_PHONE,
        },
        "unlock_test_row": {
            "id": unlock_target["id"],
            "business_key": unlock_target["business_key"],
            "original_company_phone": unlock_target["company_phone"],
            "planted_phone": UNLOCK_PHONE,
        },
        "synthetic_row": {
            "id": syn_id,
            "business_key": SYNTHETIC_BK,
            "pipeline_last_seen_at": old_seen,
        },
    }
    SNAPSHOT_PATH.parent.mkdir(exist_ok=True)
    SNAPSHOT_PATH.write_text(json.dumps(snapshot, indent=2, default=str))
    print(f"[plant] snapshot written -> {SNAPSHOT_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
