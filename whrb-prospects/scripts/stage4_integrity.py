#!/usr/bin/env python3
"""Stage 4 integrity check suite.

Runs after two Stage 4 pipeline invocations (``--fresh --with-hic`` then a
plain resume-from-checkpoint rerun) and the manual-override plant
(``stage4_plant.py``) performed between them. Reads
``cache/stage4_snapshot.json`` for the override target.

Checks (numbered per plan Stage 4):
  T01 >= 50 rows with is_nonprofit=true AND nonprofit_source='irs_bmf'
  T02 canonical nonprofit spot-checks (MFA, BSO, Handel & Haydn, Isabella
      Stewart Gardner, Boston Ballet) all flagged with valid EINs — except
      any that was consumed as the manual-override fixture
  T03 five for-profit spot-checks are NOT flagged is_nonprofit=true
  T04 manual override persisted across rerun (override row still false +
      manual + locked)
  T05 EIN format: every non-null ein matches ``NN-NNNNNNN``
  T06 cache freshness: zero ``category='bmf_download'`` events inside run
      #2's window

Exit code: 0 iff every check passes.
"""
from __future__ import annotations

import json
import os
import re
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

SNAPSHOT_PATH = WHRB / "cache" / "stage4_snapshot.json"

CANONICAL_NONPROFITS = [
    ("Museum of Fine Arts", "museum of fine arts"),
    ("Boston Symphony Orchestra", "boston symphony"),
    # Needle matches "Handel & Haydn" (ampersand) as well as "Handel and Haydn".
    ("Handel and Haydn Society", "handel"),
    ("Isabella Stewart Gardner", "isabella stewart gardner"),
    ("Boston Ballet", "boston ballet"),
]

# Selectors for five rows that ought to NOT match BMF. Each entry is a
# company_name needle (ILIKE); match is "any row whose name contains the
# substring". Selected to cover Yelp restaurants + at least one HSBA row.
FOR_PROFIT_PROBES = [
    "felipe",        # Felipe's Taqueria, Yelp/HSBA
    "alden & harlow",
    "craigie",
    "oleana",
    "leavitt",       # Leavitt & Peirce, HSBA retailer
]

EIN_RE = re.compile(r"^\d{2}-\d{7}$")


@dataclass
class T:
    name: str
    passed: bool
    detail: str = ""


def _client():
    return create_client(SUPABASE_URL, SERVICE_KEY)


def _last_two_runs(client) -> list[dict]:
    res = (
        client.table("pipeline_runs")
        .select("*")
        .order("started_at", desc=True)
        .limit(2)
        .execute()
    )
    rows = res.data or []
    return list(reversed(rows))  # ascending


# ------------------------------- checks --------------------------------
def t01_bmf_match_count(client) -> T:
    res = (
        client.table("prospects")
        .select("id", count="exact")
        .eq("is_nonprofit", True)
        .eq("nonprofit_source", "irs_bmf")
        .execute()
    )
    count = res.count or 0
    return T(
        "T01 >=50 rows with is_nonprofit=true AND nonprofit_source='irs_bmf'",
        count >= 50,
        f"count={count}",
    )


def t02_canonical_flags(client, override_id: str | None) -> T:
    missing: list[str] = []
    sampled: list[str] = []
    for label, needle in CANONICAL_NONPROFITS:
        q = (
            client.table("prospects")
            .select("id,company_name,is_nonprofit,ein,nonprofit_source")
            .ilike("company_name", f"%{needle}%")
        )
        res = q.execute()
        rows = res.data or []
        if not rows:
            missing.append(f"{label}: NOT_IN_DB")
            continue
        # If one of these is the override fixture, skip it — it's
        # intentionally flipped. We only require the *remaining* canonical
        # rows to be flagged.
        candidates = [r for r in rows if r["id"] != override_id]
        if not candidates:
            sampled.append(f"{label}: SKIPPED_AS_OVERRIDE")
            continue
        ok = [
            r for r in candidates
            if r["is_nonprofit"] is True
            and r["nonprofit_source"] == "irs_bmf"
            and r["ein"] and EIN_RE.match(r["ein"])
        ]
        if not ok:
            sample = candidates[0]
            missing.append(
                f"{label}: name={sample['company_name']!r} "
                f"is_np={sample['is_nonprofit']} ein={sample['ein']!r} "
                f"src={sample['nonprofit_source']!r}"
            )
        else:
            sampled.append(f"{label}: {ok[0]['ein']}")
    passed = not missing
    detail = (
        f"flagged={sampled}"
        if passed
        else f"missing={missing}; flagged={sampled}"
    )
    return T("T02 canonical nonprofit spot-checks flagged", passed, detail)


def t03_for_profit_not_flagged(client) -> T:
    false_positives: list[str] = []
    covered: list[str] = []
    for needle in FOR_PROFIT_PROBES:
        res = (
            client.table("prospects")
            .select("id,company_name,is_nonprofit,nonprofit_source")
            .ilike("company_name", f"%{needle}%")
            .limit(5)
            .execute()
        )
        rows = res.data or []
        if not rows:
            covered.append(f"{needle}:NO_ROW")
            continue
        bad = [
            r for r in rows
            if r["is_nonprofit"] is True and r["nonprofit_source"] == "irs_bmf"
        ]
        if bad:
            false_positives.append(
                f"{needle}: {bad[0]['company_name']!r}"
            )
        else:
            covered.append(f"{needle}:{rows[0]['company_name'][:30]}")
    return T(
        "T03 five for-profit spot-checks NOT flagged is_nonprofit",
        not false_positives,
        f"checked={covered} false_positives={false_positives}",
    )


def t04_manual_override_persisted(client, snapshot: dict) -> T:
    ov = snapshot["override_row"]
    res = (
        client.table("prospects")
        .select("id,company_name,is_nonprofit,nonprofit_source,ein,user_overrides")
        .eq("id", ov["id"])
        .execute()
    )
    if not res.data:
        return T("T04 manual override persisted", False, "override row gone")
    row = res.data[0]
    ok_flag = row["is_nonprofit"] is False
    ok_src = row["nonprofit_source"] == "manual"
    ok_lock = bool((row.get("user_overrides") or {}).get("is_nonprofit"))
    return T(
        "T04 manual override persisted across rerun",
        ok_flag and ok_src and ok_lock,
        f"is_nonprofit={row['is_nonprofit']!r} source={row['nonprofit_source']!r} "
        f"overrides={row.get('user_overrides')!r}",
    )


def t05_ein_format(client) -> T:
    out: list[str] = []
    start = 0
    page = 1000
    while True:
        res = (
            client.table("prospects")
            .select("id,ein")
            .not_.is_("ein", "null")
            .range(start, start + page - 1)
            .execute()
        )
        batch = res.data or []
        for r in batch:
            if r["ein"] and not EIN_RE.match(r["ein"]):
                out.append(f"{r['id']}:{r['ein']!r}")
        if len(batch) < page:
            break
        start += page
    return T(
        "T05 all EINs match NN-NNNNNNN format",
        not out,
        f"violations={len(out)} sample={out[:3]}",
    )


def t06_cache_freshness(client, runs: list[dict]) -> T:
    if len(runs) < 2:
        return T("T06 cache freshness", False, f"only {len(runs)} recent runs")
    run2 = runs[-1]
    started = run2["started_at"]
    finished = run2.get("finished_at")
    q = (
        client.table("event_log")
        .select("id,category,message", count="exact")
        .eq("category", "bmf_download")
        .gte("created_at", started)
    )
    if finished:
        q = q.lte("created_at", finished)
    res = q.execute()
    count = res.count or 0
    return T(
        "T06 zero bmf_download events in run #2 window",
        count == 0,
        f"bmf_download_events_in_run2={count} window=[{started}..{finished}]",
    )


# ------------------------------- main ----------------------------------
def main() -> int:
    if not SNAPSHOT_PATH.exists():
        print(
            f"FATAL: {SNAPSHOT_PATH} missing — run scripts/stage4_plant.py first",
            file=sys.stderr,
        )
        return 2
    snapshot = json.loads(SNAPSHOT_PATH.read_text())
    override_id = snapshot["override_row"]["id"]

    client = _client()
    runs = _last_two_runs(client)
    print(f"Stage 4 integrity — last {len(runs)} runs:")
    for r in runs:
        print(
            f"  run {r['id']}: started={r['started_at']} "
            f"finished={r.get('finished_at')} status={r['status']} "
            f"rows_upserted={r.get('rows_upserted')}"
        )

    results = [
        t01_bmf_match_count(client),
        t02_canonical_flags(client, override_id),
        t03_for_profit_not_flagged(client),
        t04_manual_override_persisted(client, snapshot),
        t05_ein_format(client),
        t06_cache_freshness(client, runs),
    ]

    print("\nStage 4 integrity results:")
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
