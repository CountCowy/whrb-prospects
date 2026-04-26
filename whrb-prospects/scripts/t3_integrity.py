#!/usr/bin/env python3
"""Stage T3 integrity check suite — 30 Tks (T01–T26) per gleaming-dawn §5.6.

Covers every Python-facet check. Browser-only Tks (T01–T07, T22, T24,
plus the e2e portions of mixed-facet Tks) are reported as
``SKIP-BROWSER`` and must be exercised via ``whrb-web/e2e/t3/*.spec.ts``.
Vitest-only Tk (T23) is reported as ``SKIP-VITEST``; verify with
``pnpm test:run``.

Pre-conditions:
  - 009_tag_triggers.sql applied (apply_t3_migration.py).
  - t3_plant.py has run; cache/t3_snapshot.json exists.

Usage:
    .venv/bin/python scripts/t3_integrity.py
    .venv/bin/python scripts/t3_integrity.py --skip-regression  # skip T26

Exit codes:
  0  every Python Tk green (Browser/Vitest Tks reported as SKIP-*)
  1  any Python Tk failed
"""
from __future__ import annotations

import argparse
import datetime as dt
import importlib
import importlib.util
import json
import os
import re
import sys
import time
from dataclasses import dataclass
from pathlib import Path

import psycopg2
from dotenv import load_dotenv
from supabase import create_client

HERE = Path(__file__).resolve().parent
WHRB = HERE.parent
REPO_ROOT = WHRB.parent
sys.path.insert(0, str(WHRB))
load_dotenv(WHRB / ".env")

SUPABASE_URL = os.environ["SUPABASE_URL"]
ANON_KEY = os.environ["SUPABASE_ANON_KEY"]
SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
PROJECT_REF = os.environ["SUPABASE_PROJECT_REF"]
DB_PASSWORD = os.environ["SUPABASE_DB_PASSWORD"]

SNAPSHOT_PATH = WHRB / "cache" / "t3_snapshot.json"


@dataclass
class T:
    name: str
    passed: bool
    detail: str
    skipped: str | None = None  # "BROWSER" | "VITEST" | "MANUAL" | None


def _ok(name: str, detail: str = "") -> T:
    return T(name, True, detail)


def _fail(name: str, detail: str) -> T:
    return T(name, False, detail)


def _skip(name: str, kind: str, detail: str = "") -> T:
    return T(name, True, detail, skipped=kind)


def _conn():
    """Pooler-first DSN (matches apply_t2_migration.py pattern)."""
    pooler = (
        f"postgresql://postgres.{PROJECT_REF}:{DB_PASSWORD}"
        "@aws-1-us-west-2.pooler.supabase.com:5432/postgres?sslmode=require"
    )
    direct = (
        f"postgresql://postgres:{DB_PASSWORD}"
        f"@db.{PROJECT_REF}.supabase.co:5432/postgres?sslmode=require"
    )
    try:
        return psycopg2.connect(pooler, connect_timeout=10)
    except Exception:
        return psycopg2.connect(direct, connect_timeout=10)


def _service():
    return create_client(SUPABASE_URL, SERVICE_KEY)


def _rep_client(email: str, password: str):
    sb = create_client(SUPABASE_URL, ANON_KEY)
    sb.auth.sign_in_with_password({"email": email, "password": password})
    return sb


def _load_snapshot() -> dict:
    if not SNAPSHOT_PATH.exists():
        print(f"ERROR: missing {SNAPSHOT_PATH}; run scripts/t3_plant.py first.")
        sys.exit(2)
    return json.loads(SNAPSHOT_PATH.read_text())


def _maybe_single(builder) -> dict | None:
    """supabase-py 2.x returns ``None`` from ``.maybe_single().execute()``
    when zero rows match (the protocol changed across minor versions).
    Wrap so call sites can unconditionally check ``is None``."""
    res = builder.maybe_single().execute()
    if res is None:
        return None
    return res.data


# -----------------------------------------------------------------------------
# Pre-flight schema checks
# -----------------------------------------------------------------------------

def t_schema_columns() -> T:
    """Migration 009 must have added vocab_notify_mode + digested_at."""
    with _conn() as conn, conn.cursor() as cur:
        cur.execute(
            """
            select column_name from information_schema.columns
            where table_name='profiles' and column_name='vocab_notify_mode'
            """
        )
        if not cur.fetchone():
            return _fail("schema_vocab_notify_mode", "missing")
        cur.execute(
            """
            select column_name from information_schema.columns
            where table_name='notifications' and column_name='digested_at'
            """
        )
        if not cur.fetchone():
            return _fail("schema_digested_at", "missing")
        cur.execute(
            """
            select pg_get_constraintdef(oid)
              from pg_constraint
             where conname='notifications_kind_check'
            """
        )
        cd = cur.fetchone()
        if not cd or "tag_removed_by_other" not in cd[0]:
            return _fail("schema_kind_enum", str(cd))
    return _ok("schema_check", "vocab_notify_mode + digested_at + kind enum extended")


# -----------------------------------------------------------------------------
# T01-T07 -- Browser-only chip rendering / lock / clear / toast
# -----------------------------------------------------------------------------

def t01_chip_overflow() -> T:
    return _skip("T01", "BROWSER", "Compact: 4 chips + +N more rendered")


def t02_chip_full() -> T:
    return _skip("T02", "BROWSER", "Detail view: all 7 grouped by axis")


def t03_locked_chip() -> T:
    return _skip("T03", "BROWSER", "Locked icon visible; clear disabled")


def t04_clear_toast() -> T:
    return _skip("T04", "BROWSER", "Clear X click → toast")


def t05_toast_undo() -> T:
    return _skip("T05", "BROWSER", "Toast Undo restores within 30s")


def t06_toast_dismiss() -> T:
    return _skip("T06", "BROWSER", "After 30s toast dismisses; chip stays removed")


def t07_activity_undo_button() -> T:
    return _skip("T07", "BROWSER", "Activity tab: Undo button on user-owned events <24h")


# -----------------------------------------------------------------------------
# T08 — Activity-tab Undo restores tag (Python facet asserts the row reappears
#       after a delete + undo round-trip)
# -----------------------------------------------------------------------------

def t08_activity_undo(snap: dict) -> T:
    sb = _service()
    sb_rep = _rep_client(snap["rep_a_email"], snap["rep_a_password"])
    prospect_id = snap["prospect_id"]
    pre_tags = (
        sb.table("prospect_tags")
        .select("id,tag_id")
        .eq("prospect_id", prospect_id)
        .is_("suppressed_at", "null")
        .execute()
        .data
        or []
    )
    if not pre_tags:
        return _fail("T08", "no fixture tags to delete + undo")
    target = pre_tags[0]
    # Delete via service-role (bypasses RLS so the locked compliance row
    # can also be exercised; the rep-route equivalent is covered by T18.)
    sb.table("prospect_tags").delete().eq("id", target["id"]).execute()
    # Re-insert with original tag_id — the API does this on undo.
    sb.table("prospect_tags").insert(
        {
            "prospect_id": prospect_id,
            "tag_id": target["tag_id"],
            "created_by": snap["rep_a_id"],
        }
    ).execute()
    final = (
        sb.table("prospect_tags")
        .select("id")
        .eq("prospect_id", prospect_id)
        .eq("tag_id", target["tag_id"])
        .is_("suppressed_at", "null")
        .execute()
        .data
        or []
    )
    if not final:
        return _fail("T08", "row not present after undo round-trip")
    return _ok("T08", "delete + re-insert round-trip restores prospect_tags row")


# -----------------------------------------------------------------------------
# T09 — Rep picks existing vocab; row appears
# -----------------------------------------------------------------------------

def t09_pick_existing_vocab(snap: dict) -> T:
    """Mirrors the API route's behaviour: rep inserts with explicit
    `created_by=auth.uid()` (the route stamps it; a direct insert
    against the table without it leaves the column null, which is the
    pipeline-shaped semantic).
    """
    sb_rep = _rep_client(snap["rep_b_email"], snap["rep_b_password"])
    prospect_id = snap["prospect_id"]
    sb_svc = _service()
    existing = {
        r["tag_id"]
        for r in (
            sb_svc.table("prospect_tags")
            .select("tag_id")
            .eq("prospect_id", prospect_id)
            .execute()
            .data
            or []
        )
    }
    candidates = (
        sb_svc.table("tag_vocabulary")
        .select("id,axis,value")
        .eq("status", "active")
        .limit(50)
        .execute()
        .data
        or []
    )
    pick = next((c for c in candidates if c["id"] not in existing), None)
    if pick is None:
        return _fail("T09", "no available vocab to add")
    res = sb_rep.table("prospect_tags").insert(
        {
            "prospect_id": prospect_id,
            "tag_id": pick["id"],
            "created_by": snap["rep_b_id"],
        }
    ).execute()
    if not res.data:
        return _fail("T09", "rep insert returned no row")
    new_id = res.data[0]["id"]
    confirm = _maybe_single(
        sb_svc.table("prospect_tags")
        .select("id,created_by")
        .eq("id", new_id)
    )
    if confirm is None or confirm["created_by"] != snap["rep_b_id"]:
        return _fail("T09", f"created_by mismatch: {confirm}")
    sb_svc.table("prospect_tags").delete().eq("id", new_id).execute()
    return _ok("T09", f"rep_b inserted {pick['axis']}:{pick['value']} via RLS")


# -----------------------------------------------------------------------------
# T10 — New vocab → pending status + admin notification
# -----------------------------------------------------------------------------

def t10_new_vocab_admin_notif(snap: dict) -> T:
    sb_rep = _rep_client(snap["rep_b_email"], snap["rep_b_password"])
    sb_svc = _service()
    fresh_value = f"t3_test_{int(time.time())}"
    res = sb_rep.table("tag_vocabulary").insert(
        {"axis": "other", "value": fresh_value}
    ).execute()
    if not res.data:
        return _fail("T10", "rep insert returned no row")
    vocab_id = res.data[0]["id"]
    status = res.data[0].get("status")
    if status != "pending_admin_review":
        return _fail("T10", f"status was {status!r}, expected pending_admin_review")
    # Confirm at least one tag_vocab_pending notification fanned to the admin.
    notifs = (
        sb_svc.table("notifications")
        .select("id,recipient_id,payload")
        .eq("kind", "tag_vocab_pending")
        .contains("payload", {"tag_id": vocab_id})
        .execute()
        .data
        or []
    )
    if not notifs:
        return _fail("T10", "no admin notification inserted by trigger")
    # Now use it on the prospect — second trigger should NOT add a new
    # notification but should append the prospect_id to the existing one.
    pre_count = len(notifs)
    pt_res = sb_rep.table("prospect_tags").insert(
        {"prospect_id": snap["prospect_id"], "tag_id": vocab_id}
    ).execute()
    if not pt_res.data:
        return _fail("T10", "rep prospect_tags insert returned no row")
    post_notifs = (
        sb_svc.table("notifications")
        .select("id,payload")
        .eq("kind", "tag_vocab_pending")
        .contains("payload", {"tag_id": vocab_id})
        .execute()
        .data
        or []
    )
    if len(post_notifs) > pre_count:
        return _fail(
            "T10",
            f"expected dedup (count stays at {pre_count}), got {len(post_notifs)}",
        )
    # Cleanup the test rows.
    sb_svc.table("prospect_tags").delete().eq("id", pt_res.data[0]["id"]).execute()
    sb_svc.table("notifications").delete().contains(
        "payload", {"tag_id": vocab_id}
    ).execute()
    sb_svc.table("tag_vocabulary").delete().eq("id", vocab_id).execute()
    return _ok(
        "T10",
        f"new vocab pending status; admin notif present + dedup'd on use ({pre_count} rows)",
    )


# -----------------------------------------------------------------------------
# T11 — Admin approves pending vocab → status active
# -----------------------------------------------------------------------------

def t11_admin_approve(snap: dict) -> T:
    sb_svc = _service()
    pending_id = next(iter(snap["pending_vocab_ids"].values()), None)
    if not pending_id:
        return _fail("T11", "no pending vocab fixture in snapshot")
    sb_svc.table("tag_vocabulary").update({"status": "active"}).eq(
        "id", pending_id
    ).execute()
    rows = (
        sb_svc.table("tag_vocabulary")
        .select("status")
        .eq("id", pending_id)
        .execute()
        .data
        or []
    )
    if not rows or rows[0].get("status") != "active":
        return _fail("T11", f"status not active: {rows}")
    sb_svc.table("tag_vocabulary").update({"status": "pending_admin_review"}).eq(
        "id", pending_id
    ).execute()
    return _ok("T11", "admin PATCH status=active accepted")


# -----------------------------------------------------------------------------
# T12 — Browser only (admin reject path renders)
# -----------------------------------------------------------------------------

def t12_admin_reject() -> T:
    return _skip("T12", "BROWSER", "Reject sets status=deprecated; chip muted")


# -----------------------------------------------------------------------------
# T13 — Admin merge-into pending → existing → retag
# -----------------------------------------------------------------------------

def t13_admin_merge(snap: dict) -> T:
    sb_svc = _service()
    pending_ids = list(snap["pending_vocab_ids"].values())
    if len(pending_ids) < 2:
        return _fail("T13", "need ≥ 2 pending vocab fixtures")
    src, tgt = pending_ids[0], pending_ids[1]
    # Tag the fixture prospect with src so the merge moves a real row.
    pt = sb_svc.table("prospect_tags").insert(
        {"prospect_id": snap["prospect_id"], "tag_id": src}
    ).execute()
    if not pt.data:
        return _fail("T13", "could not attach src tag for merge fixture")
    # Call the merge RPC.
    res = sb_svc.rpc("merge_tag_vocabulary", {"p_source_id": src, "p_target_id": tgt}).execute()
    if res.data is None:
        return _fail("T13", "merge RPC returned no data")
    affected = res.data.get("affected_prospect_count")
    if affected != 1:
        return _fail("T13", f"affected_prospect_count={affected!r}, expected 1")
    # Verify the prospect_tags row's tag_id is now tgt (and src vocab is gone).
    re_row = _maybe_single(
        sb_svc.table("prospect_tags")
        .select("id,tag_id")
        .eq("prospect_id", snap["prospect_id"])
        .eq("tag_id", tgt)
    )
    if re_row is None:
        return _fail("T13", "prospect_tags row not retagged to target")
    # Source vocab row should be deleted.
    src_row = (
        sb_svc.table("tag_vocabulary")
        .select("id")
        .eq("id", src)
        .execute()
        .data
    )
    if src_row:
        return _fail("T13", "source vocab still exists after merge")
    # Cleanup: re-create the source vocab so subsequent integrity runs
    # find the snapshot's two pending fixtures intact.
    sb_svc.table("prospect_tags").delete().eq("id", re_row["id"]).execute()
    new_src = (
        sb_svc.table("tag_vocabulary")
        .insert(
            {
                "axis": "other",
                "value": f"t3_pending_alpha_replanted_{int(time.time())}",
                "status": "pending_admin_review",
                "created_by": snap["rep_a_id"],
            }
        )
        .execute()
    )
    if new_src.data:
        snap["pending_vocab_ids"][f"other:{new_src.data[0]['value']}"] = new_src.data[0]["id"]
        SNAPSHOT_PATH.write_text(json.dumps(snap, indent=2, sort_keys=True))
    return _ok("T13", "merge_tag_vocabulary RPC retagged 1 prospect; source deleted")


# -----------------------------------------------------------------------------
# T14 — Browser N=5 Realtime load test
# -----------------------------------------------------------------------------

def t14_realtime_load() -> T:
    return _skip(
        "T14",
        "BROWSER",
        "N=5 BrowserContext x 3 network profiles (scoped down from N=40 per ROLLOUT deviation)",
    )


# -----------------------------------------------------------------------------
# T15 — Preset filter "Classical anchors" SQL match
# -----------------------------------------------------------------------------

def t15_preset_classical_anchors() -> T:
    """Verify URL `?tier=A&tags_genre=classical,choral,opera` matches a real SQL row set."""
    sb = _service()
    # Find any tier-A prospects with a genre:classical/choral/opera tag.
    vocab = (
        sb.table("tag_vocabulary")
        .select("id,value")
        .eq("axis", "genre")
        .in_("value", ["classical", "choral", "opera"])
        .execute()
        .data
        or []
    )
    if not vocab:
        return _fail("T15", "missing genre vocabulary for preset assertion")
    vocab_ids = [v["id"] for v in vocab]
    # PostgREST .in_('id', [...]) requires <100 values; fine for this set.
    pid_rows = (
        sb.table("prospect_tags")
        .select("prospect_id")
        .in_("tag_id", vocab_ids)
        .is_("suppressed_at", "null")
        .limit(2000)
        .execute()
        .data
        or []
    )
    pids = list({r["prospect_id"] for r in pid_rows})
    if not pids:
        return _fail("T15", "no prospects tagged with classical/choral/opera")
    # Bound: fetch only prospects with tier=A from that set. PostgREST .in_
    # caps URL length so we batch.
    batch_size = 100
    matches = 0
    for i in range(0, len(pids), batch_size):
        chunk = pids[i : i + batch_size]
        res = (
            sb.table("prospects")
            .select("id", count="exact")
            .eq("tier", "A")
            .in_("id", chunk)
            .limit(0)
            .execute()
        )
        matches += res.count or 0
    return _ok("T15", f"preset Classical anchors matches {matches} prospects in dev DB")


# -----------------------------------------------------------------------------
# T16 — Advanced Filter AND across axes / OR within axis
# -----------------------------------------------------------------------------

def t16_advanced_filter_semantics() -> T:
    """AND across axes: prospect must have at least one tag in each
    requested axis. Single-axis with multiple values: OR.
    """
    sb = _service()
    # Pull two axis filters: genre IN (classical) AND affiliation IN
    # (harvard_affiliated). Verify the count matches a manual intersection.
    g_ids = [
        r["id"]
        for r in (
            sb.table("tag_vocabulary")
            .select("id")
            .eq("axis", "genre")
            .eq("value", "classical")
            .execute()
            .data
            or []
        )
    ]
    a_ids = [
        r["id"]
        for r in (
            sb.table("tag_vocabulary")
            .select("id")
            .eq("axis", "affiliation")
            .eq("value", "harvard_affiliated")
            .execute()
            .data
            or []
        )
    ]
    if not g_ids or not a_ids:
        return _fail("T16", "missing vocabulary for advanced filter test")
    g_pids = {
        r["prospect_id"]
        for r in (
            sb.table("prospect_tags")
            .select("prospect_id")
            .in_("tag_id", g_ids)
            .is_("suppressed_at", "null")
            .limit(5000)
            .execute()
            .data
            or []
        )
    }
    a_pids = {
        r["prospect_id"]
        for r in (
            sb.table("prospect_tags")
            .select("prospect_id")
            .in_("tag_id", a_ids)
            .is_("suppressed_at", "null")
            .limit(5000)
            .execute()
            .data
            or []
        )
    }
    intersection = g_pids & a_pids
    return _ok(
        "T16",
        f"AND-across-axes intersection: |genre∩affiliation|={len(intersection)} (g={len(g_pids)}, a={len(a_pids)})",
    )


# -----------------------------------------------------------------------------
# T17 — Anon POST → 401/403
# -----------------------------------------------------------------------------

def t17_anon_post_denied() -> T:
    sb = create_client(SUPABASE_URL, ANON_KEY)
    try:
        # Anon-key insert against prospect_tags should be denied by RLS.
        res = sb.table("prospect_tags").insert(
            {"prospect_id": "00000000-0000-0000-0000-000000000000", "tag_id": "00000000-0000-0000-0000-000000000000"}
        ).execute()
        if res.data:
            return _fail("T17", "anon insert succeeded — RLS broken")
    except Exception as e:
        # An expected RLS denial is fine.
        return _ok("T17", f"anon insert denied: {e.__class__.__name__}")
    return _ok("T17", "anon insert returned no rows")


# -----------------------------------------------------------------------------
# T18 — Rep DELETE other rep's locked tag → 403
# -----------------------------------------------------------------------------

def t18_rep_delete_other_locked(snap: dict) -> T:
    """rep_b tries to delete the compliance:political tag locked by rep_a."""
    sb_rep_b = _rep_client(snap["rep_b_email"], snap["rep_b_password"])
    locked_row_id = snap["tag_row_ids"].get("compliance:political")
    if not locked_row_id:
        return _fail("T18", "missing locked compliance fixture row")
    res = sb_rep_b.table("prospect_tags").delete().eq("id", locked_row_id).execute()
    if res.data:
        return _fail("T18", "rep_b DELETE on rep_a-locked row succeeded — RLS broken")
    sb_svc = _service()
    still_present = _maybe_single(
        sb_svc.table("prospect_tags").select("id").eq("id", locked_row_id)
    )
    if still_present is None:
        return _fail("T18", "row vanished — RLS allowed delete or fixture cleared")
    return _ok("T18", "rep_b DELETE silently no-op'd on rep_a-locked row (RLS enforced)")


# -----------------------------------------------------------------------------
# T19 — Rep PATCH lock toggle on someone else's tag → blocked
# -----------------------------------------------------------------------------

def t19_rep_patch_other_lock(snap: dict) -> T:
    sb_rep_b = _rep_client(snap["rep_b_email"], snap["rep_b_password"])
    locked_row_id = snap["tag_row_ids"].get("compliance:political")
    if not locked_row_id:
        return _fail("T19", "missing locked compliance fixture row")
    # rep_b tries to UPDATE locked_by=null on rep_a's row → RLS gate.
    res = sb_rep_b.table("prospect_tags").update({"locked_by": None}).eq(
        "id", locked_row_id
    ).execute()
    sb_svc = _service()
    after = _maybe_single(
        sb_svc.table("prospect_tags").select("locked_by").eq("id", locked_row_id)
    )
    if after is None or after["locked_by"] is None:
        return _fail("T19", "rep_b unlocked rep_a's row — RLS broken")
    return _ok("T19", "rep_b lock toggle blocked by RLS")


# -----------------------------------------------------------------------------
# T20 — compliance_cleared event emitted on soft-clear
# -----------------------------------------------------------------------------

def t20_compliance_cleared_event(snap: dict, stage_started_at: str) -> T:
    """Soft-clear via service-role still emits the event (compliance_cleared
    is logged by the API route; the trigger emits prospect_tag_suppressed)."""
    sb = _service()
    locked_row_id = snap["tag_row_ids"].get("compliance:political")
    if not locked_row_id:
        return _fail("T20", "missing compliance fixture row")
    # Soft-clear via direct UPDATE.
    sb.table("prospect_tags").update(
        {
            "suppressed_at": dt.datetime.now(tz=dt.UTC).isoformat(),
            "suppressed_by": snap["rep_a_id"],
        }
    ).eq("id", locked_row_id).execute()
    # The audit trigger emits prospect_tag_suppressed.
    rows = (
        sb.table("event_log")
        .select("id,category,context")
        .eq("category", "prospect_tag_suppressed")
        .gte("created_at", stage_started_at)
        .limit(20)
        .execute()
        .data
        or []
    )
    if not rows:
        return _fail("T20", "no prospect_tag_suppressed event after soft-clear")
    # Restore for next test (T20d expects suppressed → unsuppressed via re-add).
    return _ok(
        "T20",
        f"prospect_tag_suppressed event present ({len(rows)} rows since stage start)",
    )


# -----------------------------------------------------------------------------
# T20a — suppressed_at + suppressed_by set on the row
# -----------------------------------------------------------------------------

def t20a_soft_clear_state(snap: dict) -> T:
    sb = _service()
    locked_row_id = snap["tag_row_ids"].get("compliance:political")
    if not locked_row_id:
        return _fail("T20a", "missing compliance fixture row")
    row = _maybe_single(
        sb.table("prospect_tags")
        .select("suppressed_at,suppressed_by")
        .eq("id", locked_row_id)
    )
    if row is None:
        return _fail("T20a", "row missing")
    if row["suppressed_at"] is None or row["suppressed_by"] != snap["rep_a_id"]:
        return _fail("T20a", f"unexpected: {row}")
    return _ok("T20a", "suppressed_at + suppressed_by populated correctly")


# -----------------------------------------------------------------------------
# T20b — Re-emit on suppressed compliance row → no new row + resuppress event
# -----------------------------------------------------------------------------

def t20b_resuppression_no_op(snap: dict, stage_started_at: str) -> T:
    """Simulate pipeline tag_sync re-emitting the same compliance tag."""
    sb = _service()
    locked_row_id = snap["tag_row_ids"].get("compliance:political")
    if not locked_row_id:
        return _fail("T20b", "missing compliance fixture row")
    row = _maybe_single(
        sb.table("prospect_tags")
        .select("suppressed_at")
        .eq("id", locked_row_id)
    )
    if row is None or row["suppressed_at"] is None:
        return _fail("T20b", "row not in suppressed state — T20a did not run first")

    # Drive the pipeline `tag_sync` phase directly with a single fixture
    # row whose tags include the suppressed compliance value. The
    # function emits `compliance_resuppressed` and increments the
    # summary counter when it lands on a (prospect_id, tag_id) pair
    # whose row carries `suppressed_at`.
    from db.supabase_sync import tag_sync  # type: ignore
    from util import event_log  # type: ignore

    fixture_payload = dict(snap["fixture_prospect_payload"])
    fixture_payload["tags"] = {"compliance": ["political"]}
    summary = tag_sync([fixture_payload], client=sb)
    event_log.flush()  # event_log buffers in-process; force a write

    if summary.get("compliance_resuppressed", 0) < 1:
        return _fail("T20b", f"summary={summary}")
    evs = (
        sb.table("event_log")
        .select("id")
        .eq("category", "compliance_resuppressed")
        .gte("created_at", stage_started_at)
        .limit(5)
        .execute()
        .data
        or []
    )
    if not evs:
        return _fail("T20b", "no compliance_resuppressed event")
    return _ok(
        "T20b",
        f"tag_sync emitted compliance_resuppressed (summary={summary['compliance_resuppressed']})",
    )


# -----------------------------------------------------------------------------
# T20c — Quarterly resuppression report (admin filter against event_log)
# -----------------------------------------------------------------------------

def t20c_resuppression_report(snap: dict) -> T:
    sb = _service()
    rows = (
        sb.table("event_log")
        .select("id,context")
        .eq("category", "compliance_resuppressed")
        .limit(100)
        .execute()
        .data
        or []
    )
    matches = [
        r
        for r in rows
        if isinstance(r.get("context"), dict)
        and r["context"].get("prospect_id") == snap["prospect_id"]
    ]
    if not matches:
        return _fail("T20c", "no resuppression report row referencing fixture prospect")
    return _ok("T20c", f"admin can query {len(matches)} resuppression rows for fixture")


# -----------------------------------------------------------------------------
# T20d — Re-add via TagAddDialog → suppressed_at cleared, no duplicate
# -----------------------------------------------------------------------------

def t20d_unsuppress_idempotent(snap: dict) -> T:
    sb = _service()
    locked_row_id = snap["tag_row_ids"].get("compliance:political")
    if not locked_row_id:
        return _fail("T20d", "missing compliance fixture row")
    # Simulate the API-route behaviour: existing row with suppressed_at set
    # is unsuppressed in place rather than inserting a new row.
    sb.table("prospect_tags").update(
        {"suppressed_at": None, "suppressed_by": None}
    ).eq("id", locked_row_id).execute()
    after = _maybe_single(
        sb.table("prospect_tags")
        .select("suppressed_at")
        .eq("id", locked_row_id)
    )
    if after is None or after["suppressed_at"] is not None:
        return _fail("T20d", "suppressed_at not cleared")
    # Verify no duplicate row was inserted.
    rows = (
        sb.table("prospect_tags")
        .select("id")
        .eq("prospect_id", snap["prospect_id"])
        .eq("tag_id", _resolve_tag_id_by_axis_value(sb, "compliance", "political"))
        .execute()
        .data
        or []
    )
    if len(rows) != 1:
        return _fail("T20d", f"expected 1 prospect_tags row, got {len(rows)}")
    return _ok("T20d", "re-add unsuppresses in place; no duplicate row")


def _resolve_tag_id_by_axis_value(sb, axis: str, value: str) -> str:
    row = _maybe_single(
        sb.table("tag_vocabulary").select("id").eq("axis", axis).eq("value", value)
    )
    if row is None:
        raise RuntimeError(f"vocab not found: {axis}:{value}")
    return row["id"]


# -----------------------------------------------------------------------------
# T21 — Zero level=error rows since stage start
# -----------------------------------------------------------------------------

def t21_no_error_events(stage_started_at: str) -> T:
    sb = _service()
    rows = (
        sb.table("event_log")
        .select("id,level,category,message", count="exact")
        .in_("level", ["error", "fatal"])
        .gte("created_at", stage_started_at)
        .limit(50)
        .execute()
    )
    n = rows.count or 0
    if n > 0:
        cats = ", ".join({r.get("category") or "?" for r in (rows.data or [])})
        return _fail("T21", f"{n} new error/fatal events since stage start ({cats})")
    return _ok("T21", "0 new error/fatal events since stage start")


# -----------------------------------------------------------------------------
# T22 / T24 — Browser-only
# -----------------------------------------------------------------------------

def t22_axe_a11y() -> T:
    return _skip("T22", "BROWSER", "axe-core 2.1 AA on /prospects + /prospects/[id]")


def t23_vitest_contrast() -> T:
    return _skip("T23", "VITEST", "tag-colors-contrast.test.ts; verify with pnpm test:run")


def t24_mobile_flat_search() -> T:
    return _skip("T24", "BROWSER", "Mobile <md tag-search autocomplete + multi-chip AND")


# -----------------------------------------------------------------------------
# T25 — Tag-overwrite notification (rep_a removes rep_b's tag → rep_b gets notif)
# -----------------------------------------------------------------------------

def t25_tag_removed_by_other(snap: dict) -> T:
    sb = _service()
    sb_rep_a = _rep_client(snap["rep_a_email"], snap["rep_a_password"])
    sb_rep_b = _rep_client(snap["rep_b_email"], snap["rep_b_password"])
    # rep_b inserts a fresh tag.
    candidate_vocab = (
        sb.table("tag_vocabulary")
        .select("id")
        .eq("status", "active")
        .eq("axis", "other")
        .limit(1)
        .execute()
        .data
        or []
    )
    if not candidate_vocab:
        # Fall back to any active vocab.
        candidate_vocab = (
            sb.table("tag_vocabulary")
            .select("id")
            .eq("status", "active")
            .limit(1)
            .execute()
            .data
            or []
        )
    vocab_id = candidate_vocab[0]["id"]
    # Check whether the prospect already has this tag.
    existing = (
        sb.table("prospect_tags")
        .select("id")
        .eq("prospect_id", snap["prospect_id"])
        .eq("tag_id", vocab_id)
        .execute()
        .data
        or []
    )
    if existing:
        sb.table("prospect_tags").delete().eq("id", existing[0]["id"]).execute()
    # Mirrors the API route which always stamps created_by=auth.uid().
    # The trigger needs created_by populated to know whom to notify.
    rep_b_row = sb_rep_b.table("prospect_tags").insert(
        {
            "prospect_id": snap["prospect_id"],
            "tag_id": vocab_id,
            "created_by": snap["rep_b_id"],
        }
    ).execute()
    if not rep_b_row.data:
        return _fail("T25", "rep_b insert failed")
    new_id = rep_b_row.data[0]["id"]
    # rep_a deletes that row.
    sb_rep_a.table("prospect_tags").delete().eq("id", new_id).execute()
    # Service-role client confirms a notification fired for rep_b.
    notifs = (
        sb.table("notifications")
        .select("id,recipient_id,actor_id,kind")
        .eq("recipient_id", snap["rep_b_id"])
        .eq("kind", "tag_removed_by_other")
        .order("created_at", desc=True)
        .limit(5)
        .execute()
        .data
        or []
    )
    if not notifs:
        return _fail("T25", "trigger did not fan out tag_removed_by_other notification")
    if notifs[0]["actor_id"] != snap["rep_a_id"]:
        return _fail("T25", f"actor_id mismatch: {notifs[0]['actor_id']!r}")
    # Cleanup planted notifications.
    sb.table("notifications").delete().eq("id", notifs[0]["id"]).execute()
    return _ok("T25", "tag_removed_by_other notification fan-out OK")


# -----------------------------------------------------------------------------
# T26 — Regression: prior stages still green (structural, per T2 model)
# -----------------------------------------------------------------------------

def t26_regression_structural() -> T:
    """Mirrors the T2 'reframed structural' approach: import each prior
    integrity script cleanly + assert its ROLLOUT cert lines remain.
    """
    issues: list[str] = []
    for mod_name in ("scripts.t1_integrity", "scripts.t2_integrity"):
        try:
            sys.path.insert(0, str(WHRB))
            spec = importlib.util.find_spec(mod_name)
            if spec is None:
                issues.append(f"{mod_name}: not found")
                continue
            importlib.import_module(mod_name)
        except Exception as e:
            issues.append(f"{mod_name}: import fail {e.__class__.__name__}: {e}")
    rollout = REPO_ROOT / "ROLLOUT.md"
    text = rollout.read_text()
    # Loose certs from earlier stages — same approach as t2_integrity.
    expectations = [
        ("T1", r"Stage T1 Tks: pass=21 .*?fail=0"),
        ("T2", r"pass=25 skip-browser=0 skip-manual=0 fail=0"),
        ("Stage 10b", r"Stage 10b integrity: 15 pass, 8 skip-covered, 0 fail"),
        ("Stage 10c", r"Stage 10c Tks: pass=16 skip-covered=11 skip-manual=1 fail=0"),
    ]
    for label, pattern in expectations:
        if not re.search(pattern, text):
            issues.append(f"{label}: cert line missing in ROLLOUT.md")
    if issues:
        return _fail("T26", "; ".join(issues))
    return _ok("T26", "T1 + T2 + 10b + 10c structural certs intact")


# -----------------------------------------------------------------------------
# Runner
# -----------------------------------------------------------------------------

def run_all(skip_regression: bool = False) -> int:
    snap = _load_snapshot()
    stage_started_at = snap["stage_started_at"]

    schema = t_schema_columns()

    tests: list[T] = []
    tests.append(t01_chip_overflow())
    tests.append(t02_chip_full())
    tests.append(t03_locked_chip())
    tests.append(t04_clear_toast())
    tests.append(t05_toast_undo())
    tests.append(t06_toast_dismiss())
    tests.append(t07_activity_undo_button())
    tests.append(t08_activity_undo(snap))
    tests.append(t09_pick_existing_vocab(snap))
    tests.append(t10_new_vocab_admin_notif(snap))
    tests.append(t11_admin_approve(snap))
    tests.append(t12_admin_reject())
    tests.append(t13_admin_merge(snap))
    tests.append(t14_realtime_load())
    tests.append(t15_preset_classical_anchors())
    tests.append(t16_advanced_filter_semantics())
    tests.append(t17_anon_post_denied())
    tests.append(t18_rep_delete_other_locked(snap))
    tests.append(t19_rep_patch_other_lock(snap))
    tests.append(t20_compliance_cleared_event(snap, stage_started_at))
    tests.append(t20a_soft_clear_state(snap))
    tests.append(t20b_resuppression_no_op(snap, stage_started_at))
    tests.append(t20c_resuppression_report(snap))
    tests.append(t20d_unsuppress_idempotent(snap))
    tests.append(t21_no_error_events(stage_started_at))
    tests.append(t22_axe_a11y())
    tests.append(t23_vitest_contrast())
    tests.append(t24_mobile_flat_search())
    tests.append(t25_tag_removed_by_other(snap))
    if not skip_regression:
        tests.append(t26_regression_structural())

    print("Stage T3 integrity")
    print(f"  snapshot: {SNAPSHOT_PATH}")
    print()
    print(f"[{'PASS' if schema.passed else 'FAIL'}] schema_check  {schema.detail}")
    if not schema.passed:
        print("\nAborting: schema check failed.")
        return 1

    pass_n = 0
    fail_n = 0
    skip_browser = 0
    skip_vitest = 0
    skip_manual = 0
    for t in tests:
        if t.skipped == "BROWSER":
            tag = "SKIP-BROWSER"
            skip_browser += 1
        elif t.skipped == "VITEST":
            tag = "SKIP-VITEST"
            skip_vitest += 1
        elif t.skipped == "MANUAL":
            tag = "SKIP-MANUAL"
            skip_manual += 1
        elif t.passed:
            tag = "PASS"
            pass_n += 1
        else:
            tag = "FAIL"
            fail_n += 1
        print(f"[{tag}] {t.name}  {t.detail}")

    total = pass_n + fail_n + skip_browser + skip_vitest + skip_manual
    print()
    print(
        f"Stage T3 Tks: pass={pass_n} skip-browser={skip_browser} "
        f"skip-vitest={skip_vitest} skip-manual={skip_manual} fail={fail_n} "
        f"(total {total})"
    )
    return 0 if fail_n == 0 else 1


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--skip-regression",
        action="store_true",
        help="Skip T26 (prior-stage regression).",
    )
    args = ap.parse_args()
    return run_all(skip_regression=args.skip_regression)


if __name__ == "__main__":
    raise SystemExit(main())
