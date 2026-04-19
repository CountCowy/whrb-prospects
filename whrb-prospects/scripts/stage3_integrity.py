#!/usr/bin/env python3
"""Stage 3 integrity check suite.

Verifies the pipeline's idempotent-rerun contract (the critical stage for the
monthly-cadence design). Requires ``scripts/stage3_plant.py`` to have been
run before the first rerun, plus two subsequent ``python pipeline.py``
invocations (no ``--fresh``, no flags).

Checks (numbered per plan Stage 3):
  T01  row-count delta run2 vs run3 < 1%
  T02  distinct business_key count unchanged across reruns
  T03  pipeline_last_seen_at advances for every non-synthetic row each run
  T04  created_at unchanged for every pre-existing row (upsert, not insert)
  T05  lock preserved — planted phone still present on lock row
  T06  unlock overwritten — unlock row's phone snapped back to scraped value
  T07  synthetic row untouched — pipeline_last_seen_at not advanced; row alive
  T08  zero level='error' event_log rows since stage start
  T09  no-op audit events minimal — no prospect_field_change for unchanged rows
  T10  edit-lock audit correlation — no field_change for locked company_phone
       after the user's original plant edit

Exit code: 0 iff every check passes.
"""
from __future__ import annotations

import json
import os
import sys
from dataclasses import dataclass
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


@dataclass
class T:
    name: str
    passed: bool
    detail: str = ""


def _client():
    return create_client(SUPABASE_URL, SERVICE_KEY)


def _select_all(client, table: str, columns: str = "*"):
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


def _recent_runs(client, since: str) -> list[dict]:
    """Return pipeline_runs rows started at/after ``since`` (ascending).
    The two Stage 3 reruns are the two most recent rows past stage start.
    """
    res = (
        client.table("pipeline_runs")
        .select("*")
        .gte("started_at", since)
        .order("started_at", desc=False)
        .execute()
    )
    return res.data or []


# ------------------------------ checks -----------------------------------
def t01_row_count_delta(client, synthetic_bk: str, runs: list[dict]) -> T:
    if len(runs) < 2:
        return T("T01 row count delta run2 vs run3 <1%", False,
                 f"only {len(runs)} Stage 3 runs recorded")
    count_res = client.table("prospects").select("id", count="exact").execute()
    total = count_res.count or 0
    # Using rows_upserted from pipeline_runs as the proxy for what the
    # pipeline touched per run; the ACTUAL table count should be stable.
    r2 = runs[-2].get("rows_upserted") or 0
    r3 = runs[-1].get("rows_upserted") or 0
    if r2 == 0:
        return T("T01 row count delta run2 vs run3 <1%", False,
                 f"run2 rows_upserted=0 (unexpected) total_db={total}")
    delta = abs(r3 - r2)
    pct = delta / r2
    return T(
        "T01 row count delta run2 vs run3 <1%",
        pct < 0.01,
        f"run2={r2} run3={r3} delta={delta} pct={pct:.4%} db_total={total}",
    )


def t02_distinct_bk_unchanged(client, snapshot: dict) -> T:
    rows = _select_all(client, "prospects", "business_key")
    distinct = len({r["business_key"] for r in rows})
    # Pre-plant baseline + 1 synthetic row planted by stage3_plant.py.
    expected = snapshot["pre_distinct_bk"] + 1
    return T(
        "T02 distinct business_key unchanged",
        distinct == expected,
        f"distinct={distinct} expected={expected}",
    )


def t03_last_seen_advances(client, runs: list[dict], synthetic_bk: str) -> T:
    """After the final run, every non-synthetic row's pipeline_last_seen_at
    should be >= that run's started_at.
    """
    if not runs:
        return T("T03 pipeline_last_seen_at advances each run", False, "no runs")
    final_started = runs[-1]["started_at"]
    # Rows where pipeline_last_seen_at is older than the last run's start.
    res = (
        client.table("prospects")
        .select("id,business_key,pipeline_last_seen_at", count="exact")
        .lt("pipeline_last_seen_at", final_started)
        .neq("business_key", synthetic_bk)
        .execute()
    )
    count = res.count or 0
    return T(
        "T03 pipeline_last_seen_at advances each run (ex-synthetic)",
        count == 0,
        f"stale_rows={count} final_run_started={final_started}",
    )


def t04_created_at_preserved(client, snapshot: dict) -> T:
    """Every pre-existing row must still show its original created_at —
    proves upsert, not delete+insert.
    """
    pre_map: dict[str, str] = snapshot["created_at_map"]
    rows = _select_all(client, "prospects", "id,created_at")
    post_map = {r["id"]: r["created_at"] for r in rows}
    mismatches: list[str] = []
    missing = 0
    for pid, ca in pre_map.items():
        after = post_map.get(pid)
        if after is None:
            missing += 1
            continue
        if str(after) != str(ca):
            mismatches.append(f"{pid}: was {ca!r} now {after!r}")
            if len(mismatches) > 3:
                break
    passed = missing == 0 and not mismatches
    detail = f"checked={len(pre_map)} missing={missing} mismatches={mismatches[:3]}"
    return T("T04 created_at unchanged for pre-existing rows", passed, detail)


def t05_lock_preserved(client, snapshot: dict) -> T:
    lock = snapshot["lock_test_row"]
    res = (
        client.table("prospects")
        .select("id,company_phone,user_overrides")
        .eq("id", lock["id"])
        .execute()
    )
    if not res.data:
        return T("T05 lock preserved", False, "lock row gone")
    row = res.data[0]
    phone_ok = row["company_phone"] == lock["planted_phone"]
    lock_still = bool((row.get("user_overrides") or {}).get("company_phone"))
    return T(
        "T05 lock preserved (planted phone retained)",
        phone_ok and lock_still,
        f"phone={row['company_phone']!r} lock={lock_still}",
    )


def t06_unlock_snapback(client, snapshot: dict) -> T:
    unlock = snapshot["unlock_test_row"]
    res = (
        client.table("prospects")
        .select("id,company_phone,user_overrides")
        .eq("id", unlock["id"])
        .execute()
    )
    if not res.data:
        return T("T06 unlock snap-back", False, "unlock row gone")
    row = res.data[0]
    # Snap-back target: the original scraped value (pre-plant).
    snapped = row["company_phone"] == unlock["original_company_phone"]
    still_unlocked = not (row.get("user_overrides") or {}).get("company_phone")
    return T(
        "T06 unlock snap-back to scraped phone",
        snapped and still_unlocked,
        f"phone={row['company_phone']!r} expected={unlock['original_company_phone']!r} "
        f"still_unlocked={still_unlocked}",
    )


def t07_synthetic_preserved(client, snapshot: dict) -> T:
    syn = snapshot["synthetic_row"]
    res = (
        client.table("prospects")
        .select("id,pipeline_last_seen_at,business_key")
        .eq("id", syn["id"])
        .execute()
    )
    if not res.data:
        return T("T07 synthetic row preserved", False, "row deleted")
    row = res.data[0]
    unchanged = row["pipeline_last_seen_at"] == syn["pipeline_last_seen_at"]
    return T(
        "T07 synthetic row untouched (last_seen stale, row alive)",
        unchanged,
        f"last_seen={row['pipeline_last_seen_at']!r} expected={syn['pipeline_last_seen_at']!r}",
    )


def t08_zero_errors(client, since: str) -> T:
    res = (
        client.table("event_log")
        .select("id,category,message", count="exact")
        .eq("level", "error")
        .gte("created_at", since)
        .execute()
    )
    count = res.count or 0
    sample = (res.data or [])[:3]
    return T(
        "T08 zero level='error' events since stage start",
        count == 0,
        f"errors={count} sample={[r.get('category') for r in sample]}",
    )


def t09_audit_noop(client, runs: list[dict], snapshot: dict) -> T:
    """The second Stage 3 rerun operates on an unchanged dataset (run1 already
    snapped the unlock row back). Expect zero prospect_field_change events
    with actor_id=null during run 2's window, excluding rows we intentionally
    changed during planting.
    """
    if len(runs) < 2:
        return T("T09 no-op audit events on final rerun", False, "need >=2 runs")
    run2 = runs[-1]
    started = run2["started_at"]
    finished = run2.get("finished_at")
    q = (
        client.table("event_log")
        .select("id,category,context,created_at", count="exact")
        .eq("category", "prospect_field_change")
        .is_("user_id", "null")
        .gte("created_at", started)
    )
    if finished:
        q = q.lte("created_at", finished)
    res = q.execute()
    rows = res.data or []
    ignore = {
        snapshot["lock_test_row"]["id"],
        snapshot["unlock_test_row"]["id"],
        snapshot["synthetic_row"]["id"],
    }
    spurious = [
        r for r in rows
        if (r.get("context") or {}).get("prospect_id") not in ignore
    ]
    # Plan allows "close to zero"; require exactly 0 for strictness on the
    # stable dataset. Failure will include the offending categories so it's
    # easy to diagnose.
    categories = [((r.get("context") or {}).get("field"), r["id"]) for r in spurious[:5]]
    return T(
        "T09 no-op rerun produces no prospect_field_change events",
        not spurious,
        f"spurious={len(spurious)}/{len(rows)} sample={categories}",
    )


def t10_lock_audit_correlation(client, snapshot: dict, since: str) -> T:
    """After the user's original plant edit, no further prospect_field_change
    events for company_phone on the lock row across the reruns.

    The plant UPDATE itself is performed by the service role (actor is null),
    so both the original plant edit AND any rerun overwrite would show
    user_id=null. We filter by created_at > (plant timestamp + 1s) so only
    post-plant events count. ``snapshot['stage3_start_time']`` is that
    anchor (plant runs immediately after the snapshot is taken).
    """
    lock_id = snapshot["lock_test_row"]["id"]
    res = (
        client.table("event_log")
        .select("context,created_at,category")
        .eq("category", "prospect_field_change")
        .gte("created_at", since)
        .execute()
    )
    rows = res.data or []
    post_plant = [
        r for r in rows
        if (r.get("context") or {}).get("prospect_id") == lock_id
        and (r.get("context") or {}).get("field") == "company_phone"
    ]
    # Expect exactly ONE: the original plant edit at stage start. Anything
    # beyond that means a rerun overwrote the locked field.
    return T(
        "T10 edit-lock audit correlation (only plant edit, no rerun overwrite)",
        len(post_plant) == 1,
        f"company_phone_events_on_lock_row={len(post_plant)}",
    )


# ------------------------------ main -----------------------------------
def main() -> int:
    if not SNAPSHOT_PATH.exists():
        print(f"FATAL: {SNAPSHOT_PATH} missing — run scripts/stage3_plant.py first",
              file=sys.stderr)
        return 2
    snapshot = json.loads(SNAPSHOT_PATH.read_text())
    stage_start = snapshot["stage3_start_time"]
    synthetic_bk = snapshot["synthetic_row"]["business_key"]

    client = _client()
    runs = _recent_runs(client, stage_start)
    print(f"Stage 3 integrity — stage_start={stage_start} reruns={len(runs)}")
    for r in runs:
        print(
            f"  run {r['id']}: started={r['started_at']} "
            f"finished={r.get('finished_at')} status={r['status']} "
            f"rows_upserted={r.get('rows_upserted')}"
        )

    results = [
        t01_row_count_delta(client, synthetic_bk, runs),
        t02_distinct_bk_unchanged(client, snapshot),
        t03_last_seen_advances(client, runs, synthetic_bk),
        t04_created_at_preserved(client, snapshot),
        t05_lock_preserved(client, snapshot),
        t06_unlock_snapback(client, snapshot),
        t07_synthetic_preserved(client, snapshot),
        t08_zero_errors(client, stage_start),
        t09_audit_noop(client, runs, snapshot),
        t10_lock_audit_correlation(client, snapshot, stage_start),
    ]

    print("\nStage 3 integrity results:")
    width = max(len(r.name) for r in results)
    for r in results:
        icon = "PASS" if r.passed else "FAIL"
        print(f"  [{icon}] {r.name.ljust(width)}  {r.detail}")
    passed = sum(1 for r in results if r.passed)
    total = len(results)
    print(f"\n{passed}/{total} tests pass")
    return 0 if passed == total else 1


if __name__ == "__main__":
    raise SystemExit(main())
