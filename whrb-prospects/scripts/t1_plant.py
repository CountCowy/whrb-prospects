#!/usr/bin/env python3
"""Stage T1 plant — fixtures for the foundation/tag-schema integrity run.

Seeds:
  - One synthetic admin already exists (`kingyareh@gmail.com`, ROLLOUT
    Stage 1). T1 reuses it.
  - One synthetic rep (`t1-rep@example.com`, email_confirm=True). The
    rep is used for T05 (rep tag-add forces pending_admin_review +
    admin notification).
  - One fixture prospect (`business_key='t1-fixture-merge-prospect'`,
    company_name='T1 Fixture Merge Prospect'). Used for T09 (merge).
  - Fixture vocab values *are not* planted by this script — the
    integrity run inserts them itself so it can verify trigger
    behaviour. Cleanup is responsible for removing any survivors.

Snapshot at cache/t1_snapshot.json captures: rep_id, prospect_id, and
the stage_started_at timestamp used by T17 (zero error events since
stage start).

Idempotent: refuses to run if cache/t1_snapshot.json exists.
"""
from __future__ import annotations

import datetime as dt
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
ADMIN_EMAIL = "kingyareh@gmail.com"
REP_EMAIL = "t1-rep@example.com"
FIXTURE_PROSPECT_KEY = "t1-fixture-merge-prospect"
FIXTURE_PASSWORD = os.environ.get(
    "T1_FIXTURE_PASSWORD", "t1-fixture-password-9q3z"
)


def _client():
    return create_client(SUPABASE_URL, SERVICE_KEY)


def main() -> int:
    if SNAPSHOT_PATH.exists():
        print(
            f"Refusing to plant — snapshot already exists at {SNAPSHOT_PATH}.\n"
            "Run scripts/t1_cleanup.py first.",
            file=sys.stderr,
        )
        return 2

    SNAPSHOT_PATH.parent.mkdir(parents=True, exist_ok=True)
    sb = _client()

    # 1) Admin must exist.
    profiles = (
        sb.table("profiles")
        .select("id,email,role")
        .eq("email", ADMIN_EMAIL)
        .execute()
    )
    if not profiles.data or profiles.data[0]["role"] != "admin":
        print(f"Admin {ADMIN_EMAIL} missing or not role=admin.", file=sys.stderr)
        return 1
    admin_id = profiles.data[0]["id"]

    # 2) Synthetic rep — invite if missing, otherwise reuse.
    existing_rep = (
        sb.table("profiles")
        .select("id,email,role")
        .eq("email", REP_EMAIL)
        .execute()
    )
    if existing_rep.data:
        rep_id = existing_rep.data[0]["id"]
        print(f"Rep already present: {rep_id}")
    else:
        created = sb.auth.admin.create_user(
            {
                "email": REP_EMAIL,
                "password": FIXTURE_PASSWORD,
                "email_confirm": True,
            }
        )
        rep_id = created.user.id
        print(f"Created synthetic rep: {rep_id}")

    # 3) Fixture prospect for merge test.
    fp = (
        sb.table("prospects")
        .select("id,business_key")
        .eq("business_key", FIXTURE_PROSPECT_KEY)
        .execute()
    )
    if fp.data:
        prospect_id = fp.data[0]["id"]
        print(f"Fixture prospect already present: {prospect_id}")
    else:
        ins = (
            sb.table("prospects")
            .insert(
                {
                    "business_key": FIXTURE_PROSPECT_KEY,
                    "company_name": "T1 Fixture Merge Prospect",
                    "tier": "B",
                    "state": "researching",
                    "created_source": "manual",
                }
            )
            .execute()
        )
        prospect_id = ins.data[0]["id"]
        print(f"Created fixture prospect: {prospect_id}")

    snapshot = {
        "schema_version": "t1_plant_v1",
        "stage_started_at": dt.datetime.now(dt.UTC).isoformat(),
        "admin_id": admin_id,
        "rep_id": rep_id,
        "prospect_id": prospect_id,
        "rep_email": REP_EMAIL,
        "rep_password": FIXTURE_PASSWORD,
        "prospect_business_key": FIXTURE_PROSPECT_KEY,
    }
    SNAPSHOT_PATH.write_text(json.dumps(snapshot, indent=2))
    print(f"Wrote snapshot to {SNAPSHOT_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
