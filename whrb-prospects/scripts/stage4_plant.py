#!/usr/bin/env python3
"""Stage 4 plant + pre-snapshot helper.

Runs AFTER the first Stage 4 rerun (which must have flagged canonical
nonprofits) and BEFORE the second. Picks a BMF-matched nonprofit row and
converts it into the manual-override test fixture:

  * Sets ``is_nonprofit = false``
  * Sets ``nonprofit_source = 'manual'``
  * Sets ``user_overrides = {"is_nonprofit": true}``

If the second pipeline run preserves that row unchanged, the composite-lock
contract is verified. Snapshot goes to ``cache/stage4_snapshot.json``.
"""
from __future__ import annotations

import json
import os
import sys
from datetime import UTC, datetime
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

HERE = Path(__file__).resolve().parent
WHRB = HERE.parent
sys.path.insert(0, str(WHRB))
load_dotenv(WHRB / ".env")

SUPABASE_URL = os.environ["SUPABASE_URL"]
SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

SNAPSHOT_PATH = WHRB / "cache" / "stage4_snapshot.json"

# Preferred targets — any one that exists in the DB after run #1 is fine.
OVERRIDE_PREFERENCES = (
    "boston symphony",
    "handel and haydn",
    "isabella stewart",
    "boston ballet",
    "museum of fine arts",
)


def _pick_override_target(client) -> dict | None:
    for needle in OVERRIDE_PREFERENCES:
        res = (
            client.table("prospects")
            .select("id,business_key,company_name,is_nonprofit,ein,nonprofit_source,user_overrides")
            .ilike("company_name", f"%{needle}%")
            .eq("is_nonprofit", True)
            .eq("nonprofit_source", "irs_bmf")
            .limit(1)
            .execute()
        )
        if res.data:
            return res.data[0]
    # Fallback: any BMF-matched row.
    res = (
        client.table("prospects")
        .select("id,business_key,company_name,is_nonprofit,ein,nonprofit_source,user_overrides")
        .eq("is_nonprofit", True)
        .eq("nonprofit_source", "irs_bmf")
        .limit(1)
        .execute()
    )
    return (res.data or [None])[0]


def main() -> int:
    client = create_client(SUPABASE_URL, SERVICE_KEY)

    stage4_plant_time = datetime.now(tz=UTC).isoformat()
    print(f"[stage4-plant] plant time: {stage4_plant_time}")

    target = _pick_override_target(client)
    if not target:
        print(
            "[stage4-plant] FATAL: no BMF-matched row in DB yet — did run #1 finish?",
            file=sys.stderr,
        )
        return 1

    print(
        f"[stage4-plant] override target id={target['id']} "
        f"name={target['company_name']!r} orig_ein={target['ein']!r}"
    )

    merged_overrides = dict(target.get("user_overrides") or {})
    merged_overrides["is_nonprofit"] = True

    client.table("prospects").update({
        "is_nonprofit": False,
        "nonprofit_source": "manual",
        "user_overrides": merged_overrides,
    }).eq("id", target["id"]).execute()

    snapshot = {
        "stage4_plant_time": stage4_plant_time,
        "override_row": {
            "id": target["id"],
            "business_key": target["business_key"],
            "company_name": target["company_name"],
            "original_is_nonprofit": target["is_nonprofit"],
            "original_ein": target["ein"],
            "original_nonprofit_source": target["nonprofit_source"],
            "original_user_overrides": target.get("user_overrides") or {},
            "planted_is_nonprofit": False,
            "planted_nonprofit_source": "manual",
            "planted_user_overrides": merged_overrides,
        },
    }
    SNAPSHOT_PATH.parent.mkdir(exist_ok=True)
    SNAPSHOT_PATH.write_text(json.dumps(snapshot, indent=2, default=str))
    print(f"[stage4-plant] snapshot written -> {SNAPSHOT_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
