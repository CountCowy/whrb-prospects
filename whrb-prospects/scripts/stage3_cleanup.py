#!/usr/bin/env python3
"""Stage 3 teardown.

After integrity checks pass:

  * Lock row: restore the pre-plant ``company_phone`` and clear
    ``user_overrides`` so the pipeline can manage it again.
  * Unlock row: no-op — the rerun already snapped it back; user_overrides
    was never touched.
  * Synthetic row: hard-delete — it exists solely to prove non-destruction.

The script reads ``cache/stage3_snapshot.json`` and is idempotent.
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

SNAPSHOT_PATH = WHRB / "cache" / "stage3_snapshot.json"


def main() -> int:
    if not SNAPSHOT_PATH.exists():
        print(f"no snapshot at {SNAPSHOT_PATH} — nothing to clean up")
        return 0
    snap = json.loads(SNAPSHOT_PATH.read_text())
    client = create_client(SUPABASE_URL, SERVICE_KEY)

    lock = snap["lock_test_row"]
    client.table("prospects").update({
        "company_phone": lock["original_company_phone"],
        "user_overrides": {},
    }).eq("id", lock["id"]).execute()
    print(f"[cleanup] lock row {lock['id']} restored -> {lock['original_company_phone']!r}, overrides cleared")

    syn = snap["synthetic_row"]
    client.table("prospects").delete().eq("id", syn["id"]).execute()
    print(f"[cleanup] synthetic row {syn['id']} deleted")

    # unlock row: the rerun snapped it back; nothing to do.
    print(f"[cleanup] unlock row {snap['unlock_test_row']['id']} left alone (pipeline handled it)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
