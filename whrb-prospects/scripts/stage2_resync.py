"""Re-run phase 08_supabase_sync against the existing CSV without rescraping.

Used after a sync-phase bugfix when the upstream phases already produced a
valid output/whrb_prospects.csv. Mirrors the run_start / sync / run_finish
bookend that pipeline.py performs so every event_log row carries a pipeline_run_id.
"""
from __future__ import annotations

import math
import os
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
from dotenv import load_dotenv

WHRB_PROSPECTS = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(WHRB_PROSPECTS))
load_dotenv(WHRB_PROSPECTS / ".env")

from db import supabase_sync
from util import event_log

CSV_PATH = WHRB_PROSPECTS / "output" / "whrb_prospects.csv"


def _coerce_row(row: dict) -> dict:
    out = {}
    for k, v in row.items():
        if isinstance(v, float) and math.isnan(v):
            out[k] = None
        else:
            out[k] = v
    return out


def main() -> int:
    if not CSV_PATH.exists():
        print(f"[resync] missing CSV at {CSV_PATH}", file=sys.stderr)
        return 2

    df = pd.read_csv(CSV_PATH)
    rows = [_coerce_row(r) for r in df.to_dict(orient="records")]
    print(f"[resync] loaded {len(rows)} rows from CSV")

    client = supabase_sync._client()
    run_id = str(uuid.uuid4())
    started_at = datetime.now(tz=timezone.utc).isoformat()
    argv = "stage2_resync.py"
    try:
        client.table("pipeline_runs").insert(
            {"id": run_id, "status": "running", "args": argv, "started_at": started_at}
        ).execute()
    except Exception as e:  # noqa: BLE001
        print(f"[resync] pipeline_runs insert failed: {e}", file=sys.stderr)
        return 3
    event_log.set_pipeline_run_id(run_id)

    event_log.info("run_start", f"resync run_start ({argv})", context={"args": argv})

    supabase_sync.seed_source_config(client)

    summary = supabase_sync.sync(rows)
    print(f"[resync] summary={summary}")

    status = "success"
    if summary.get("failed", 0) > 0:
        status = "failed"
    event_log.info(
        "run_finish",
        f"resync run_finish ({status})",
        context={"status": status, **summary},
    )
    try:
        client.table("pipeline_runs").update(
            {
                "status": status,
                "finished_at": datetime.now(tz=timezone.utc).isoformat(),
                "rows_upserted": summary.get("inserted", 0) + summary.get("updated", 0),
            }
        ).eq("id", run_id).execute()
    except Exception as e:  # noqa: BLE001
        print(f"[resync] pipeline_runs finalize failed: {e}", file=sys.stderr)

    event_log.flush()
    return 0 if status == "success" else 1


if __name__ == "__main__":
    raise SystemExit(main())
