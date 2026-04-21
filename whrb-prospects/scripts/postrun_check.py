#!/usr/bin/env python3
"""postrun_check.py — edit-preservation diff verifier.

Reads cache/stage8_snapshot.json (the planted 20-row change set) and asserts
every target value is still reflected in public.prospects + public.prospect_notes
after a pipeline rerun. Prints a per-row ``[PASS]``/``[FAIL]`` line; exits 0
when all rows match, non-zero on any drift.

This is the reusable guardrail called out in plan §6.4: Stage 8 runs it twice
(after each rerun), Stage 11 re-runs it against prod, and the Stage 10
post-run workflow may invoke it for drift detection.

Usage:
  .venv/bin/python scripts/postrun_check.py [--snapshot cache/stage8_snapshot.json]
                                            [--quiet]
"""
from __future__ import annotations

import argparse
import json
import os
import sys
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

DEFAULT_SNAPSHOT = WHRB / "cache" / "stage8_snapshot.json"


def _client():
    return create_client(SUPABASE_URL, SERVICE_KEY)


def _fetch_rows(client, ids: list[str]) -> dict[str, dict]:
    out: dict[str, dict] = {}
    if not ids:
        return out
    for i in range(0, len(ids), 200):
        chunk = ids[i : i + 200]
        res = (
            client.table("prospects")
            .select(
                "id,business_key,assigned_to,state,company_phone,company_email,"
                "is_nonprofit,nonprofit_source,ein,user_overrides,"
                "pipeline_last_seen_at"
            )
            .in_("id", chunk)
            .execute()
        )
        for row in res.data or []:
            out[row["id"]] = row
    return out


def _fetch_notes_for(client, prospect_ids: list[str]) -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {pid: [] for pid in prospect_ids}
    if not prospect_ids:
        return out
    for i in range(0, len(prospect_ids), 200):
        chunk = prospect_ids[i : i + 200]
        res = (
            client.table("prospect_notes")
            .select("id,prospect_id,author_id,body,deleted_at,created_at")
            .in_("prospect_id", chunk)
            .execute()
        )
        for row in res.data or []:
            out.setdefault(row["prospect_id"], []).append(row)
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--snapshot", default=str(DEFAULT_SNAPSHOT))
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()

    snap_path = Path(args.snapshot)
    if not snap_path.exists():
        print(f"[postrun_check] FATAL: snapshot missing: {snap_path}", file=sys.stderr)
        return 2
    snap = json.loads(snap_path.read_text())
    groups = snap["groups"]

    client = _client()

    all_ids = {
        entry["row_id"]
        for group_name in groups
        for entry in groups[group_name]
    }
    rows = _fetch_rows(client, sorted(all_ids))
    notes_by_prospect = _fetch_notes_for(
        client, [e["row_id"] for e in groups["notes"]]
    )

    failures: list[str] = []
    checks_run = 0
    started_at_iso = snap["started_at_iso"]

    def _log(ok: bool, tag: str, detail: str) -> None:
        nonlocal checks_run
        checks_run += 1
        mark = "PASS" if ok else "FAIL"
        if ok and args.quiet:
            return
        print(f"[{mark}] {tag:28s} {detail}")
        if not ok:
            failures.append(f"{tag}: {detail}")

    # pickup_state: assigned_to + state unchanged from target.
    for entry in groups["pickup_state"]:
        row = rows.get(entry["row_id"])
        if not row:
            _log(False, "pickup_state:missing", f"row {entry['row_id']} not in DB")
            continue
        ok_assign = row.get("assigned_to") == entry["target_assigned_to"]
        ok_state = row.get("state") == entry["target_state"]
        _log(
            ok_assign and ok_state,
            "pickup_state",
            f"id={entry['row_id'][:8]} assigned_to={row.get('assigned_to')} "
            f"state={row.get('state')!r} expected={entry['target_state']!r}",
        )

    # phone_lock: company_phone == target AND user_overrides.company_phone=true.
    for entry in groups["phone_lock"]:
        row = rows.get(entry["row_id"])
        if not row:
            _log(False, "phone_lock:missing", f"row {entry['row_id']} not in DB")
            continue
        ok_value = row.get("company_phone") == entry["target_phone"]
        ok_lock = bool((row.get("user_overrides") or {}).get("company_phone"))
        _log(
            ok_value and ok_lock,
            "phone_lock",
            f"id={entry['row_id'][:8]} phone={row.get('company_phone')!r} "
            f"lock={ok_lock}",
        )

    # notes: find at least one non-deleted note with matching body.
    for entry in groups["notes"]:
        rid = entry["row_id"]
        bodies = [
            (n.get("body"), n.get("deleted_at"))
            for n in notes_by_prospect.get(rid, [])
        ]
        ok = any(
            body == entry["body"] and deleted is None
            for (body, deleted) in bodies
        )
        _log(ok, "notes", f"id={rid[:8]} body_match={ok} count={len(bodies)}")

    # nonprofit_lock: is_nonprofit + nonprofit_source + user_overrides.is_nonprofit.
    for entry in groups["nonprofit_lock"]:
        row = rows.get(entry["row_id"])
        if not row:
            _log(False, "nonprofit_lock:missing", f"row {entry['row_id']} not in DB")
            continue
        ok_flag = bool(row.get("is_nonprofit")) == bool(entry["target_is_nonprofit"])
        ok_src = row.get("nonprofit_source") == entry["target_nonprofit_source"]
        ok_lock = bool((row.get("user_overrides") or {}).get("is_nonprofit"))
        _log(
            ok_flag and ok_src and ok_lock,
            "nonprofit_lock",
            f"id={entry['row_id'][:8]} flag={row.get('is_nonprofit')} "
            f"src={row.get('nonprofit_source')!r} lock={ok_lock}",
        )

    # email_lock: company_email == target AND user_overrides.company_email=true.
    for entry in groups["email_lock"]:
        row = rows.get(entry["row_id"])
        if not row:
            _log(False, "email_lock:missing", f"row {entry['row_id']} not in DB")
            continue
        ok_value = row.get("company_email") == entry["target_email"]
        ok_lock = bool((row.get("user_overrides") or {}).get("company_email"))
        _log(
            ok_value and ok_lock,
            "email_lock",
            f"id={entry['row_id'][:8]} email={row.get('company_email')!r} "
            f"lock={ok_lock}",
        )

    status = 0 if not failures else 1
    print(
        f"[postrun_check] checks={checks_run} pass={checks_run - len(failures)} "
        f"fail={len(failures)} snapshot_started_at={started_at_iso}"
    )
    return status


if __name__ == "__main__":
    sys.exit(main())
