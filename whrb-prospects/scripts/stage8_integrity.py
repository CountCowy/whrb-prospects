#!/usr/bin/env python3
"""Stage 8 integrity — 12 checks (T01–T12) on the post-rerun DB state.

Read cache/stage8_snapshot.json (the 20-row change set planted via
chrome-devtools MCP) and assert every edit survived two pipeline reruns.

Execution model:
  * Reruns are launched outside this script (Bash run_in_background=true).
  * After each rerun, ``postrun_check.py`` is invoked and its exit code
    recorded to ``cache/stage8_postrun_<N>.exit`` — T02 / T03 read those files.
  * This script is the single-shot final verifier (T01 + T04..T12 inspect
    live DB state; T02 / T03 read the recorded postrun exits).

Runs through Supabase service-role client.

Usage:
  .venv/bin/python scripts/stage8_integrity.py
"""
from __future__ import annotations

import json
import os
import random
import sys
from dataclasses import dataclass
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

CACHE_DIR = WHRB / "cache"
SNAPSHOT_PATH = CACHE_DIR / "stage8_snapshot.json"
POSTRUN_EXITS = {
    1: CACHE_DIR / "stage8_postrun_1.exit",
    2: CACHE_DIR / "stage8_postrun_2.exit",
}

RANDOM_SAMPLE_SIZE = 50
RANDOM_SEED = 20260420


@dataclass
class T:
    name: str
    passed: bool
    detail: str


def _client():
    return create_client(SUPABASE_URL, SERVICE_KEY)


def _snapshot() -> dict:
    if not SNAPSHOT_PATH.exists():
        raise SystemExit(f"Missing {SNAPSHOT_PATH}. Run stage8_plant.py first.")
    return json.loads(SNAPSHOT_PATH.read_text())


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


def _fetch_notes(client, prospect_ids: list[str]) -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {pid: [] for pid in prospect_ids}
    if not prospect_ids:
        return out
    res = (
        client.table("prospect_notes")
        .select("id,prospect_id,author_id,body,deleted_at,created_at")
        .in_("prospect_id", prospect_ids)
        .execute()
    )
    for row in res.data or []:
        out.setdefault(row["prospect_id"], []).append(row)
    return out


def _audit_events(
    client, prospect_id: str, field: str, since_iso: str
) -> list[dict]:
    """Return event_log rows for a given prospect_id + field since `since_iso`.

    Uses a `contains` filter on the jsonb context column which Postgres
    accelerates via the jsonb GIN index configured in 000_init.sql.
    """
    res = (
        client.table("event_log")
        .select("id,category,context,user_id,source,created_at")
        .in_(
            "category",
            [
                "prospect_field_change",
                "prospect_state_change",
                "prospect_assignment_change",
            ],
        )
        .contains("context", {"prospect_id": prospect_id, "field": field})
        .gte("created_at", since_iso)
        .execute()
    )
    return res.data or []


def _sample_nonplanted_ids(client, exclude: set[str], since_iso: str) -> list[str]:
    """Pick RANDOM_SAMPLE_SIZE random pipeline-touched prospect ids not in `exclude`.

    "Pipeline-touched" = ``pipeline_last_seen_at >= since_iso``, which excludes
    rows that the current scrape no longer produces (their business_key fell
    out of the corpus, so the rerun never `_patch`es them — by design, per
    Stage 3 T07). Sampling only from touched rows keeps T10 a clean
    "did the rerun advance last_seen on rows it claims to maintain"
    assertion, instead of doubling as an orphan-detection probe.
    """
    rng = random.Random(RANDOM_SEED)
    rows = (
        client.table("prospects")
        .select("id")
        .eq("created_source", "pipeline")
        .gte("pipeline_last_seen_at", since_iso)
        .limit(5000)
        .execute()
        .data
        or []
    )
    ids = [r["id"] for r in rows if r["id"] not in exclude]
    rng.shuffle(ids)
    return ids[:RANDOM_SAMPLE_SIZE]


def _read_exit(path: Path) -> int | None:
    if not path.exists():
        return None
    raw = path.read_text().strip()
    if not raw:
        return None
    try:
        return int(raw.splitlines()[0].strip())
    except ValueError:
        return None


def _t01_plant_applied(client, snap: dict) -> T:
    """T01 — 20-row change set is currently reflected in the DB."""
    groups = snap["groups"]
    all_ids = {e["row_id"] for g in groups.values() for e in g}
    rows = _fetch_rows(client, sorted(all_ids))
    notes = _fetch_notes(client, [e["row_id"] for e in groups["notes"]])
    problems: list[str] = []

    for e in groups["pickup_state"]:
        r = rows.get(e["row_id"])
        if not r:
            problems.append(f"pickup:missing {e['row_id']}")
            continue
        if r.get("assigned_to") != e["target_assigned_to"]:
            problems.append(f"pickup:assignee {e['row_id']}")
        if r.get("state") != e["target_state"]:
            problems.append(f"pickup:state {e['row_id']}")

    for e in groups["phone_lock"]:
        r = rows.get(e["row_id"])
        if not r:
            problems.append(f"phone:missing {e['row_id']}")
            continue
        if r.get("company_phone") != e["target_phone"]:
            problems.append(f"phone:value {e['row_id']}")
        if not (r.get("user_overrides") or {}).get("company_phone"):
            problems.append(f"phone:lock {e['row_id']}")

    for e in groups["notes"]:
        bodies = [n for n in notes.get(e["row_id"], []) if n.get("deleted_at") is None]
        if not any(n.get("body") == e["body"] for n in bodies):
            problems.append(f"note:missing {e['row_id']}")

    for e in groups["nonprofit_lock"]:
        r = rows.get(e["row_id"])
        if not r:
            problems.append(f"np:missing {e['row_id']}")
            continue
        if bool(r.get("is_nonprofit")) != bool(e["target_is_nonprofit"]):
            problems.append(f"np:flag {e['row_id']}")
        if r.get("nonprofit_source") != e["target_nonprofit_source"]:
            problems.append(f"np:source {e['row_id']}")
        if not (r.get("user_overrides") or {}).get("is_nonprofit"):
            problems.append(f"np:lock {e['row_id']}")

    for e in groups["email_lock"]:
        r = rows.get(e["row_id"])
        if not r:
            problems.append(f"email:missing {e['row_id']}")
            continue
        if r.get("company_email") != e["target_email"]:
            problems.append(f"email:value {e['row_id']}")
        if not (r.get("user_overrides") or {}).get("company_email"):
            problems.append(f"email:lock {e['row_id']}")

    n_rows = len(all_ids)
    return T(
        "T01 plant applied to 20 rows",
        passed=(not problems),
        detail=(
            f"rows={n_rows} problems={len(problems)}"
            + (f" first={problems[0]}" if problems else "")
        ),
    )


def _tNN_postrun_exit(n: int) -> T:
    path = POSTRUN_EXITS[n]
    exit_code = _read_exit(path)
    ok = exit_code == 0
    return T(
        f"T0{n + 1} postrun_check after rerun #{n} (exit=0)",
        passed=ok,
        detail=f"exit_file={path.name} exit={exit_code}",
    )


def _t04_phone_locks(client, snap: dict) -> T:
    rows = _fetch_rows(
        client, [e["row_id"] for e in snap["groups"]["phone_lock"]]
    )
    mismatches: list[str] = []
    for e in snap["groups"]["phone_lock"]:
        r = rows.get(e["row_id"])
        if not r:
            mismatches.append(f"{e['row_id']}:missing")
            continue
        if r.get("company_phone") != e["target_phone"]:
            mismatches.append(f"{e['row_id']}:value")
        if not (r.get("user_overrides") or {}).get("company_phone"):
            mismatches.append(f"{e['row_id']}:lock")
    return T(
        "T04 5 phone locks intact after reruns",
        passed=(not mismatches),
        detail=f"rows=5 mismatches={len(mismatches)}",
    )


def _t05_state_changes(client, snap: dict) -> T:
    rows = _fetch_rows(
        client, [e["row_id"] for e in snap["groups"]["pickup_state"]]
    )
    mismatches: list[str] = []
    for e in snap["groups"]["pickup_state"]:
        r = rows.get(e["row_id"])
        if not r or r.get("state") != e["target_state"]:
            mismatches.append(e["row_id"])
    return T(
        "T05 5 state changes persisted",
        passed=(not mismatches),
        detail=f"rows=5 mismatches={len(mismatches)}",
    )


def _t06_notes(client, snap: dict) -> T:
    notes = _fetch_notes(
        client, [e["row_id"] for e in snap["groups"]["notes"]]
    )
    missing: list[str] = []
    for e in snap["groups"]["notes"]:
        live = [
            n
            for n in notes.get(e["row_id"], [])
            if n.get("deleted_at") is None and n.get("body") == e["body"]
        ]
        if not live:
            missing.append(e["row_id"])
    return T(
        "T06 5 notes present (not soft-deleted, body intact)",
        passed=(not missing),
        detail=f"rows=5 missing={len(missing)}",
    )


def _t07_pickups(client, snap: dict) -> T:
    rows = _fetch_rows(
        client, [e["row_id"] for e in snap["groups"]["pickup_state"]]
    )
    mismatches: list[str] = []
    for e in snap["groups"]["pickup_state"]:
        r = rows.get(e["row_id"])
        if not r or r.get("assigned_to") != e["target_assigned_to"]:
            mismatches.append(e["row_id"])
    return T(
        "T07 5 pick-ups still assigned to planter",
        passed=(not mismatches),
        detail=f"rows=5 mismatches={len(mismatches)}",
    )


def _t08_nonprofit(client, snap: dict) -> T:
    rows = _fetch_rows(
        client, [e["row_id"] for e in snap["groups"]["nonprofit_lock"]]
    )
    bad: list[str] = []
    for e in snap["groups"]["nonprofit_lock"]:
        r = rows.get(e["row_id"])
        if not r:
            bad.append(f"{e['row_id']}:missing")
            continue
        if bool(r.get("is_nonprofit")) != bool(e["target_is_nonprofit"]):
            bad.append(f"{e['row_id']}:flag")
        if r.get("nonprofit_source") != e["target_nonprofit_source"]:
            bad.append(f"{e['row_id']}:source")
        if not (r.get("user_overrides") or {}).get("is_nonprofit"):
            bad.append(f"{e['row_id']}:lock")
    return T(
        "T08 3 nonprofit overrides preserved",
        passed=(not bad),
        detail=f"rows=3 mismatches={len(bad)}",
    )


def _t09_email(client, snap: dict) -> T:
    rows = _fetch_rows(
        client, [e["row_id"] for e in snap["groups"]["email_lock"]]
    )
    bad: list[str] = []
    for e in snap["groups"]["email_lock"]:
        r = rows.get(e["row_id"])
        if not r:
            bad.append(f"{e['row_id']}:missing")
            continue
        if r.get("company_email") != e["target_email"]:
            bad.append(f"{e['row_id']}:value")
        if not (r.get("user_overrides") or {}).get("company_email"):
            bad.append(f"{e['row_id']}:lock")
    return T(
        "T09 2 email edits preserved + locked",
        passed=(not bad),
        detail=f"rows=2 mismatches={len(bad)}",
    )


def _t10_nonplanted_seen(client, snap: dict) -> T:
    planted = {e["row_id"] for g in snap["groups"].values() for e in g}
    since = snap["started_at_iso"]
    sample = _sample_nonplanted_ids(client, planted, since)
    rows = _fetch_rows(client, sample)
    stale: list[str] = []
    for rid in sample:
        r = rows.get(rid)
        if not r:
            stale.append(f"{rid}:missing")
            continue
        last_seen = r.get("pipeline_last_seen_at")
        if not last_seen or last_seen <= since:
            stale.append(f"{rid}:last_seen={last_seen}")
    enough = len(sample) >= RANDOM_SAMPLE_SIZE
    return T(
        f"T10 {RANDOM_SAMPLE_SIZE} non-planted touched rows last_seen > stage_start",
        passed=(enough and not stale),
        detail=(
            f"sampled={len(sample)} stale={len(stale)} since={since}"
            + ("" if enough else f" (need >= {RANDOM_SAMPLE_SIZE})")
        ),
    )


def _t11_no_errors(client, snap: dict) -> T:
    since = snap["started_at_iso"]
    res = (
        client.table("event_log")
        .select("id", count="exact", head=True)
        .in_("level", ["error", "fatal"])
        .gte("created_at", since)
        .execute()
    )
    n = res.count or 0
    return T(
        "T11 0 level='error'|'fatal' events since stage start",
        passed=(n == 0),
        detail=f"errors={n} since={since}",
    )


def _t12_actor_attribution(client, snap: dict) -> T:
    """For each of the 15 prospect-field edits, assert ≥1 event_log row with
    the correct category + actor. Note rows are checked via prospect_notes.author_id.
    """
    since = snap["started_at_iso"]
    admin = snap["admin_id"]
    rep_a = snap["rep_a_id"]
    rep_b = snap["rep_b_id"]

    problems: list[str] = []
    # pickup_state: assignment + state, actor = rep_a
    for e in snap["groups"]["pickup_state"]:
        for field in ("assigned_to", "state"):
            evs = _audit_events(client, e["row_id"], field, since)
            ok = any(
                (ev.get("context") or {}).get("actor_id") == rep_a for ev in evs
            )
            if not ok:
                problems.append(f"pickup:{field}:{e['row_id']}")

    # phone_lock: company_phone, actor = admin
    for e in snap["groups"]["phone_lock"]:
        evs = _audit_events(client, e["row_id"], "company_phone", since)
        ok = any((ev.get("context") or {}).get("actor_id") == admin for ev in evs)
        if not ok:
            problems.append(f"phone:company_phone:{e['row_id']}")

    # nonprofit_lock: is_nonprofit, actor = admin
    for e in snap["groups"]["nonprofit_lock"]:
        evs = _audit_events(client, e["row_id"], "is_nonprofit", since)
        ok = any((ev.get("context") or {}).get("actor_id") == admin for ev in evs)
        if not ok:
            problems.append(f"np:is_nonprofit:{e['row_id']}")

    # email_lock: company_email, actor = admin
    for e in snap["groups"]["email_lock"]:
        evs = _audit_events(client, e["row_id"], "company_email", since)
        ok = any((ev.get("context") or {}).get("actor_id") == admin for ev in evs)
        if not ok:
            problems.append(f"email:company_email:{e['row_id']}")

    # notes: author_id matches planted author_id
    note_ids = [e["row_id"] for e in snap["groups"]["notes"]]
    notes = _fetch_notes(client, note_ids)
    expected_author = {e["row_id"]: e["author_id"] for e in snap["groups"]["notes"]}
    expected_body = {e["row_id"]: e["body"] for e in snap["groups"]["notes"]}
    for pid, expected in expected_author.items():
        matches = [
            n
            for n in notes.get(pid, [])
            if n.get("body") == expected_body[pid]
            and n.get("author_id") == expected
            and n.get("deleted_at") is None
        ]
        if not matches:
            problems.append(f"note:author:{pid}")

    return T(
        "T12 actor_id attributions (15 field edits + 5 notes)",
        passed=(not problems),
        detail=(
            f"checks=20 problems={len(problems)}"
            + (f" first={problems[0]}" if problems else "")
        ),
    )


def main() -> int:
    snap = _snapshot()
    client = _client()

    results: list[T] = []
    results.append(_t01_plant_applied(client, snap))
    results.append(_tNN_postrun_exit(1))
    results.append(_tNN_postrun_exit(2))
    results.append(_t04_phone_locks(client, snap))
    results.append(_t05_state_changes(client, snap))
    results.append(_t06_notes(client, snap))
    results.append(_t07_pickups(client, snap))
    results.append(_t08_nonprofit(client, snap))
    results.append(_t09_email(client, snap))
    results.append(_t10_nonplanted_seen(client, snap))
    results.append(_t11_no_errors(client, snap))
    results.append(_t12_actor_attribution(client, snap))

    for r in results:
        mark = "PASS" if r.passed else "FAIL"
        print(f"[{mark}] {r.name:55s} {r.detail}")

    passed = sum(1 for r in results if r.passed)
    total = len(results)
    print(f"\n{passed}/{total} pass")
    return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(main())
