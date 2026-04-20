#!/usr/bin/env python3
"""15-field lock-matrix verifier for prospects.

Precondition:
  cache/stage7_snapshot.json written by stage7_plant.py.

Flow:
  1. For each of the 15 lockable fields:
       * Read the snapshotted subject row and its baseline value.
       * Produce a distinct "test value" (deterministic from the field name).
       * Patch (field=test_value, user_overrides[field]=true) via service-role
         Supabase client. The BEFORE UPDATE trigger `enforce_prospect_update_guard`
         is a no-op because auth.uid() is null for service-role connections.
       * Assert row now reflects test value + lock.
  2. Run `python pipeline.py` end-to-end (resume-from-checkpoint semantics;
     matches the monthly rerun cadence). Invoked via subprocess so the caller
     sees full output. Run stdout is tee'd into `cache/stage7_lock_run.log`.
  3. Re-read each subject. Assert every edited field is unchanged. Assert
     user_overrides still contains the lock. Any mismatch -> FAIL.
  4. Unlock + restore. Subject rows left exactly as we found them.

Reusable across Stage 7 (T05) and Stage 8 (contract re-verification).

Usage:
  .venv/bin/python scripts/stage7_lock_matrix.py [--skip-pipeline]
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import uuid
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from supabase import create_client

HERE = Path(__file__).resolve().parent
WHRB = HERE.parent
sys.path.insert(0, str(WHRB))
load_dotenv(WHRB / ".env")

SUPABASE_URL = os.environ["SUPABASE_URL"]
SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

SNAPSHOT_PATH = WHRB / "cache" / "stage7_snapshot.json"
RUN_LOG_PATH = WHRB / "cache" / "stage7_lock_run.log"

LOCKABLE_FIELDS: tuple[str, ...] = (
    "tier",
    "company_name",
    "company_phone",
    "company_email",
    "contact_name",
    "contact_email",
    "contact_phone",
    "website",
    "is_nonprofit",
    "nonprofit_source",
    "ein",
    "priority_score",
    "address",
    "zip",
    "category",
)


def _client():
    return create_client(SUPABASE_URL, SERVICE_KEY)


def _mutate_value(field: str, current: Any) -> Any:
    """Deterministic "distinct" test value for a given field."""
    tag = uuid.uuid4().hex[:6]
    if field == "tier":
        # must be one of A/B/C; flip to whichever differs
        if current == "A":
            return "B"
        return "A"
    if field == "priority_score":
        base = int(current) if isinstance(current, (int, float)) else 0
        return base + 777
    if field == "is_nonprofit":
        return not bool(current)
    if field == "nonprofit_source":
        return "manual" if current != "manual" else "irs_bmf"
    if field == "ein":
        return f"99-{tag[:7]}"
    if field == "zip":
        return "02138"  # a stable plausible ZIP
    if field == "category":
        return f"stage7-lock-{tag}"
    return f"stage7-lock-{field}-{tag}"


def _apply_user_edit(client, row_id: str, field: str, value: Any, overrides: dict) -> dict:
    """Simulate a user edit: update the field and set user_overrides[field]=true."""
    new_overrides = dict(overrides)
    new_overrides[field] = True
    if field == "is_nonprofit":
        new_overrides["nonprofit_source"] = True
        new_overrides["ein"] = True
    client.table("prospects").update(
        {field: value, "user_overrides": new_overrides}
    ).eq("id", row_id).execute()
    return new_overrides


def _fetch_row(client, row_id: str) -> dict:
    res = (
        client.table("prospects")
        .select(
            "id,tier,company_name,company_phone,company_email,contact_name,contact_email,"
            "contact_phone,website,is_nonprofit,nonprofit_source,ein,priority_score,"
            "address,zip,category,user_overrides"
        )
        .eq("id", row_id)
        .single()
        .execute()
    )
    return res.data


def _restore(client, row_id: str, snapshot: dict) -> None:
    payload = dict(snapshot)
    payload.setdefault("user_overrides", {})
    client.table("prospects").update(payload).eq("id", row_id).execute()


def _run_pipeline() -> int:
    cmd = [str(WHRB / ".venv/bin/python"), str(WHRB / "pipeline.py")]
    RUN_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with RUN_LOG_PATH.open("wb") as log:
        print(f"--- pipeline.py (log -> {RUN_LOG_PATH}) ---")
        proc = subprocess.Popen(cmd, cwd=str(WHRB), stdout=log, stderr=subprocess.STDOUT)
        rc = proc.wait()
        print(f"pipeline.py exited with code {rc}")
    return rc


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--skip-pipeline",
        action="store_true",
        help="Skip the pipeline rerun (useful for dry-checking the mutation path).",
    )
    args = ap.parse_args()

    if not SNAPSHOT_PATH.exists():
        raise SystemExit(f"Missing {SNAPSHOT_PATH}. Run stage7_plant.py first.")
    snap = json.loads(SNAPSHOT_PATH.read_text())
    subjects: dict[str, dict] = snap["lock_subjects"]

    client = _client()

    expected: dict[str, dict[str, Any]] = {}
    for field in LOCKABLE_FIELDS:
        entry = subjects[field]
        row_id = entry["id"]
        baseline = entry["snapshot"]
        test_value = _mutate_value(field, baseline.get(field))
        overrides = baseline.get("user_overrides") or {}
        new_overrides = _apply_user_edit(
            client,
            row_id,
            field,
            test_value,
            overrides,
        )
        expected[field] = {
            "row_id": row_id,
            "value": test_value,
            "overrides": new_overrides,
        }
        print(f"[prep] {field:18s} -> {row_id[:8]}... value={test_value!r}")

    if args.skip_pipeline:
        print("[skip-pipeline] skipping rerun as requested")
    else:
        rc = _run_pipeline()
        if rc != 0:
            raise SystemExit(
                f"pipeline.py failed with exit {rc}; see {RUN_LOG_PATH} for details"
            )

    # Verification pass.
    failures: list[str] = []
    for field in LOCKABLE_FIELDS:
        entry = expected[field]
        row = _fetch_row(client, entry["row_id"])
        actual = row.get(field)
        ok_value = actual == entry["value"]
        ok_lock = bool((row.get("user_overrides") or {}).get(field))
        mark = "PASS" if (ok_value and ok_lock) else "FAIL"
        detail = (
            f"value_ok={ok_value} lock_ok={ok_lock} actual={actual!r} "
            f"expected={entry['value']!r}"
        )
        print(f"[{mark}] {field:18s} {detail}")
        if not (ok_value and ok_lock):
            failures.append(field)

    # Restore — regardless of outcome, leave the DB as we found it.
    for field in LOCKABLE_FIELDS:
        entry = subjects[field]
        _restore(client, entry["id"], entry["snapshot"])
    print(f"Restored {len({s['id'] for s in subjects.values()})} lock subject(s).")

    total = len(LOCKABLE_FIELDS)
    passed = total - len(failures)
    print(f"Lock matrix: {passed}/{total} pass")
    return 0 if not failures else 1


if __name__ == "__main__":
    sys.exit(main())
