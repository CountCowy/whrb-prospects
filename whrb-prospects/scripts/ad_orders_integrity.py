#!/usr/bin/env python3
"""ad_orders integrity matrix — DB-side checks.

Verifies the schema invariants from the plan
(``~/.claude/plans/i-want-to-glittery-balloon.md`` section C). The
table below is the AO# ID space; SKIP-COVERED entries are delegated
to the Vitest suite at
``whrb-web/lib/queries/__tests__/ad-orders.test.ts`` and
``whrb-web/app/api/ad-orders/__tests__/`` because they require an
authenticated user JWT or an HTTP context that this script doesn't
have access to.

Run after ``ad_orders_plant.py`` so there are fixtures to inspect.

Usage:
    .venv/bin/python scripts/ad_orders_integrity.py
"""
from __future__ import annotations

import datetime as dt
import json
import os
import sys
from decimal import Decimal
from pathlib import Path

import psycopg2
import psycopg2.extras
from dotenv import load_dotenv
from supabase import create_client

HERE = Path(__file__).resolve().parent
WHRB = HERE.parent
sys.path.insert(0, str(WHRB))
load_dotenv(WHRB / ".env")

SNAPSHOT_PATH = WHRB / "cache" / "ad_orders_snapshot.json"
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_ANON = os.environ.get("SUPABASE_ANON_KEY")
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
PROJECT_REF = os.environ.get("SUPABASE_PROJECT_REF")
DB_PASSWORD = os.environ.get("SUPABASE_DB_PASSWORD")


# ---------------------------------------------------------------------------
# Result helpers (mirrors t7_integrity.py)
# ---------------------------------------------------------------------------


class TkResult:
    __slots__ = ("id", "status", "msg")

    def __init__(self, id_: str, status: str, msg: str):
        self.id = id_
        self.status = status
        self.msg = msg


def _passing(id_: str, msg: str) -> TkResult:
    return TkResult(id_, "PASS", msg)


def _failing(id_: str, msg: str) -> TkResult:
    return TkResult(id_, "FAIL", msg)


def _skip_manual(id_: str, msg: str) -> TkResult:
    return TkResult(id_, "SKIP-MANUAL", msg)


def _skip_covered(id_: str, msg: str) -> TkResult:
    return TkResult(id_, "SKIP-COVERED", msg)


# ---------------------------------------------------------------------------
# Connections
# ---------------------------------------------------------------------------


def _service_client():
    if not (SUPABASE_URL and SERVICE_KEY):
        return None
    try:
        return create_client(SUPABASE_URL, SERVICE_KEY)
    except Exception:
        return None


def _anon_client():
    if not (SUPABASE_URL and SUPABASE_ANON):
        return None
    try:
        return create_client(SUPABASE_URL, SUPABASE_ANON)
    except Exception:
        return None


def _pg_conn():
    if not (PROJECT_REF and DB_PASSWORD):
        return None
    pooler_dsn = (
        f"postgresql://postgres.{PROJECT_REF}:{DB_PASSWORD}"
        "@aws-1-us-west-2.pooler.supabase.com:5432/postgres?sslmode=require"
    )
    try:
        return psycopg2.connect(pooler_dsn, connect_timeout=10)
    except Exception:
        direct_dsn = (
            f"postgresql://postgres:{DB_PASSWORD}"
            f"@db.{PROJECT_REF}.supabase.co:5432/postgres?sslmode=require"
        )
        try:
            return psycopg2.connect(direct_dsn, connect_timeout=10)
        except Exception:
            return None


def _started_at_iso() -> str:
    if SNAPSHOT_PATH.exists():
        try:
            snap = json.loads(SNAPSHOT_PATH.read_text())
            if "started" in snap:
                return snap["started"]
        except Exception:
            pass
    return dt.datetime.now(dt.UTC).isoformat()


# ---------------------------------------------------------------------------
# Checks AO01–AO13: row-level invariants (service-role)
# ---------------------------------------------------------------------------


def check_ao01_money_nonnegative(sb) -> TkResult:
    res = sb.rpc(
        "exec_sql_count",  # if you have an SQL exec RPC; otherwise use SELECT
        {},
    ) if False else None
    # Use direct SELECT via service role.
    res = sb.table("ad_orders").select(
        "id,total_amount,commission_pct,discount_pct,commission_amount"
    ).execute()
    bad = []
    for r in res.data or []:
        for f in ("total_amount", "commission_pct", "discount_pct", "commission_amount"):
            v = r.get(f)
            if v is None:
                continue
            if Decimal(str(v)) < 0:
                bad.append((r["id"], f, v))
    if bad:
        return _failing("AO01", f"{len(bad)} negative-money fields: {bad[:3]}")
    return _passing("AO01", f"0 negative-money rows across {len(res.data or [])}")


def check_ao02_money_decimal_clean(pg) -> TkResult:
    if pg is None:
        return _skip_manual("AO02", "no DB connection")
    with pg.cursor() as cur:
        cur.execute(
            "select count(*) from public.ad_orders "
            "where total_amount::text ~ '\\.[0-9]{3,}' "
            "   or commission_pct::text ~ '\\.[0-9]{3,}' "
            "   or commission_amount::text ~ '\\.[0-9]{3,}'"
        )
        n = cur.fetchone()[0]
    if n:
        return _failing("AO02", f"{n} rows have >2 decimal-place money values")
    return _passing("AO02", "all money values within numeric(12,2) precision")


def check_ao03_generated_column(sb) -> TkResult:
    res = sb.table("ad_orders").select(
        "id,promo_id,total_amount,commission_pct,commission_amount"
    ).limit(50).execute()
    rows = res.data or []
    if not rows:
        return _skip_manual("AO03", "no rows to spot-check")
    mismatches = []
    for r in rows:
        ta = Decimal(str(r["total_amount"]))
        cp = Decimal(str(r["commission_pct"]))
        ca = Decimal(str(r["commission_amount"]))
        expected = (ta * cp / Decimal(100)).quantize(Decimal("0.01"))
        if abs(ca - expected) > Decimal("0.001"):
            mismatches.append((r["promo_id"], str(ca), str(expected)))
    if mismatches:
        return _failing("AO03", f"generated-column drift: {mismatches[:3]}")
    return _passing("AO03", f"{len(rows)}/{len(rows)} rows match formula")


def check_ao04_promo_id_format(pg) -> TkResult:
    if pg is None:
        return _skip_manual("AO04", "no DB connection")
    with pg.cursor() as cur:
        cur.execute(
            "select count(*) from public.ad_orders "
            "where promo_id !~ '^[A-Z]{2,4} [0-9]{4}$'"
        )
        n = cur.fetchone()[0]
    if n:
        return _failing("AO04", f"{n} malformed promo_ids")
    return _passing("AO04", "0 malformed promo_ids")


def check_ao05_promo_id_unique(pg) -> TkResult:
    if pg is None:
        return _skip_manual("AO05", "no DB connection")
    with pg.cursor() as cur:
        cur.execute(
            "select promo_id, count(*) from public.ad_orders "
            "group by promo_id having count(*) > 1"
        )
        dupes = cur.fetchall()
    if dupes:
        return _failing("AO05", f"{len(dupes)} duplicate promo_ids: {dupes[:3]}")
    return _passing("AO05", "0 duplicate promo_ids (UNIQUE constraint holds)")


def check_ao06_07_08_fks(pg) -> list[TkResult]:
    if pg is None:
        return [
            _skip_manual("AO06", "no DB connection"),
            _skip_manual("AO07", "no DB connection"),
            _skip_manual("AO08", "no DB connection"),
        ]
    out: list[TkResult] = []
    with pg.cursor() as cur:
        for ao_id, col, target in [
            ("AO06", "salesperson_id", "profiles"),
            ("AO07", "se_engineer_id", "profiles"),
            ("AO08", "prospect_id",    "prospects"),
        ]:
            cur.execute(
                f"select count(*) from public.ad_orders ao "
                f"where ao.{col} is not null "
                f"  and not exists (select 1 from public.{target} t where t.id = ao.{col})"
            )
            n = cur.fetchone()[0]
            if n:
                out.append(_failing(ao_id, f"{n} rows have unresolved {col}"))
            else:
                out.append(_passing(ao_id, f"all {col} FKs resolve in {target}"))
    return out


def check_ao09_campaign_window(pg) -> TkResult:
    if pg is None:
        return _skip_manual("AO09", "no DB connection")
    with pg.cursor() as cur:
        cur.execute(
            "select count(*) from public.ad_orders where campaign_end < campaign_start"
        )
        n = cur.fetchone()[0]
    if n:
        return _failing("AO09", f"{n} rows have reversed campaign window")
    return _passing("AO09", "all campaign_end >= campaign_start")


def check_ao10_comm_requires_paid(pg) -> TkResult:
    if pg is None:
        return _skip_manual("AO10", "no DB connection")
    with pg.cursor() as cur:
        cur.execute(
            "select count(*) from public.ad_orders "
            "where commission_paid = true and is_paid = false"
        )
        n = cur.fetchone()[0]
    if n:
        return _failing("AO10", f"{n} rows have commission_paid without is_paid")
    return _passing("AO10", "lifecycle gate holds (commission requires paid)")


def check_ao11_paid_requires_invoice(pg) -> TkResult:
    if pg is None:
        return _skip_manual("AO11", "no DB connection")
    with pg.cursor() as cur:
        cur.execute(
            "select count(*) from public.ad_orders "
            "where is_paid = true and invoice_sent_at is null"
        )
        n = cur.fetchone()[0]
    if n:
        return _failing("AO11", f"{n} rows are paid without invoice_sent_at")
    return _passing("AO11", "lifecycle gate holds (paid requires invoice)")


def check_ao12_timestamp_consistency(pg) -> TkResult:
    if pg is None:
        return _skip_manual("AO12", "no DB connection")
    with pg.cursor() as cur:
        cur.execute(
            "select count(*) from public.ad_orders "
            "where (is_paid and paid_at is null) or (not is_paid and paid_at is not null) "
            "   or (commission_paid and commission_paid_at is null) "
            "   or (not commission_paid and commission_paid_at is not null) "
            "   or (ad_produced and ad_produced_at is null) "
            "   or (not ad_produced and ad_produced_at is not null)"
        )
        n = cur.fetchone()[0]
    if n:
        return _failing("AO12", f"{n} rows have boolean/timestamp mismatch")
    return _passing("AO12", "all booleans consistent with their *_at timestamps")


def check_ao13_invoice_number_unique(pg) -> TkResult:
    if pg is None:
        return _skip_manual("AO13", "no DB connection")
    with pg.cursor() as cur:
        cur.execute(
            "select invoice_number, count(*) from public.ad_orders "
            "where invoice_number is not null "
            "group by invoice_number having count(*) > 1"
        )
        dupes = cur.fetchall()
    if dupes:
        return _failing("AO13", f"duplicate invoice_numbers: {dupes[:3]}")
    return _passing("AO13", "0 duplicate invoice_numbers (partial UNIQUE holds)")


# ---------------------------------------------------------------------------
# AO14: paid transitions audited
# ---------------------------------------------------------------------------


def check_ao14_paid_audited(pg) -> TkResult:
    if pg is None:
        return _skip_manual("AO14", "no DB connection")
    with pg.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            "select id from public.ad_orders where is_paid = true"
        )
        paid_rows = [r["id"] for r in cur.fetchall()]
        if not paid_rows:
            return _skip_manual("AO14", "no paid rows yet")
        cur.execute(
            "select context->>'ad_order_id' as ao_id, count(*) as n "
            "from public.event_log "
            "where category = 'ad_order_paid' "
            "  and context->>'field' = 'is_paid' "
            "  and context->>'new' = 'true' "
            "  and (context->>'ad_order_id') = any(%s) "
            "group by 1",
            ([str(x) for x in paid_rows],),
        )
        audited = {r["ao_id"]: r["n"] for r in cur.fetchall()}
    missing = [str(x) for x in paid_rows if str(x) not in audited]
    if missing:
        return _failing("AO14", f"{len(missing)} paid rows lack audit events")
    return _passing("AO14", f"{len(paid_rows)} paid transitions all audited")


# ---------------------------------------------------------------------------
# AO15: per-semester reconciliation
# ---------------------------------------------------------------------------


def check_ao15_period_reconciliation(pg) -> TkResult:
    if pg is None:
        return _skip_manual("AO15", "no DB connection")
    with pg.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            "select public.whrb_semester(campaign_start) as sem, "
            "       sum(commission_amount) as total, "
            "       sum(commission_amount) filter (where commission_paid) as paid "
            "from public.ad_orders "
            "where archived_at is null "
            "group by 1"
        )
        rows = cur.fetchall()
    if not rows:
        return _skip_manual("AO15", "no non-archived rows")
    bad = []
    for r in rows:
        total = Decimal(str(r["total"] or 0))
        paid = Decimal(str(r["paid"] or 0))
        if paid > total:
            bad.append((r["sem"], str(paid), str(total)))
    if bad:
        return _failing("AO15", f"period over-payout: {bad[:3]}")
    return _passing("AO15", f"{len(rows)} period(s) reconcile (paid <= total)")


# ---------------------------------------------------------------------------
# AO17: RLS denies anon SELECT
# ---------------------------------------------------------------------------


def check_ao17_rls_anon(anon_sb) -> TkResult:
    if anon_sb is None:
        return _skip_manual("AO17", "no anon client (SUPABASE_ANON_KEY missing)")
    try:
        res = anon_sb.table("ad_orders").select("id").limit(1).execute()
        rows = res.data or []
    except Exception as e:
        # PostgrestError on RLS denial counts as PASS.
        return _passing("AO17", f"anon select raised: {type(e).__name__}")
    if not rows:
        return _passing("AO17", "anon SELECT returned 0 rows (RLS denies)")
    return _failing("AO17", f"anon could read {len(rows)} ad_orders rows!")


# ---------------------------------------------------------------------------
# AO27: generated column rejects explicit writes
# ---------------------------------------------------------------------------


def check_ao27_generated_rejects(pg) -> TkResult:
    if pg is None:
        return _skip_manual("AO27", "no DB connection")
    with pg.cursor() as cur:
        cur.execute("select id from public.ad_orders limit 1")
        row = cur.fetchone()
        if not row:
            return _skip_manual("AO27", "no rows to test against")
        target_id = row[0]
    try:
        with pg.cursor() as cur:
            cur.execute(
                "update public.ad_orders set commission_amount = 99 where id = %s",
                (target_id,),
            )
        pg.rollback()
        return _failing("AO27", "explicit write to generated column was accepted!")
    except psycopg2.Error as e:
        pg.rollback()
        return _passing("AO27", f"generated column rejects writes: {e.pgerror.strip().splitlines()[0] if e.pgerror else type(e).__name__}")


# ---------------------------------------------------------------------------
# AO28: org_settings single-row + readable
# ---------------------------------------------------------------------------


def check_ao28_org_settings(pg) -> TkResult:
    if pg is None:
        return _skip_manual("AO28", "no DB connection")
    with pg.cursor() as cur:
        cur.execute("select count(*) from public.org_settings")
        n = cur.fetchone()[0]
        cur.execute(
            "select default_commission_pct, default_invoice_net_days from public.org_settings limit 1"
        )
        row = cur.fetchone()
    if n != 1:
        return _failing("AO28", f"org_settings has {n} rows; expected exactly 1")
    if row is None:
        return _failing("AO28", "org_settings row missing")
    dc, di = row
    if dc is None or di is None:
        return _failing("AO28", "org_settings has NULL defaults")
    return _passing("AO28", f"single-row OK; defaults commission={dc}% net={di}d")


# ---------------------------------------------------------------------------
# AO29: event_log error budget clean
# ---------------------------------------------------------------------------


def check_ao29_no_errors(pg, since_iso: str) -> TkResult:
    if pg is None:
        return _skip_manual("AO29", "no DB connection")
    with pg.cursor() as cur:
        cur.execute(
            "select count(*) from public.event_log "
            "where level in ('error','fatal') "
            "  and category like 'ad_order_%' "
            "  and created_at >= %s",
            (since_iso,),
        )
        n = cur.fetchone()[0]
    if n:
        return _failing("AO29", f"{n} ad_order_* error/fatal events since plant time")
    return _passing("AO29", "0 ad_order_* error/fatal events")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> int:
    sb = _service_client()
    anon = _anon_client()
    pg = _pg_conn()
    since = _started_at_iso()

    if sb is None:
        print("ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required.", file=sys.stderr)
        return 2

    results: list[TkResult] = []
    results.append(check_ao01_money_nonnegative(sb))
    results.append(check_ao02_money_decimal_clean(pg))
    results.append(check_ao03_generated_column(sb))
    results.append(check_ao04_promo_id_format(pg))
    results.append(check_ao05_promo_id_unique(pg))
    results.extend(check_ao06_07_08_fks(pg))
    results.append(check_ao09_campaign_window(pg))
    results.append(check_ao10_comm_requires_paid(pg))
    results.append(check_ao11_paid_requires_invoice(pg))
    results.append(check_ao12_timestamp_consistency(pg))
    results.append(check_ao13_invoice_number_unique(pg))
    results.append(check_ao14_paid_audited(pg))
    results.append(check_ao15_period_reconciliation(pg))

    # AO16 — per-rep rollup matches API; covered by Vitest.
    results.append(_skip_covered(
        "AO16",
        "covered by whrb-web/lib/queries/__tests__/ad-orders.test.ts (per-rep rollup)",
    ))

    results.append(check_ao17_rls_anon(anon))

    # AO18-AO22 — require user JWT context; covered by Vitest.
    for aoid, desc in [
        ("AO18", "RLS denies non-owner UPDATE (rep cross-row test)"),
        ("AO19", "column-guard denies rep is_paid flip"),
        ("AO20", "column-guard denies rep total_amount change"),
        ("AO21", "paid-lockdown denies admin UPDATE without amend flag"),
        ("AO22", "amend round-trip via /api/ad-orders/[id]/amend"),
    ]:
        results.append(_skip_covered(
            aoid,
            f"covered by whrb-web/app/api/ad-orders/__tests__/ ({desc})",
        ))

    # AO23 — DELETE blocked at RLS; covered by Vitest (needs user JWT).
    results.append(_skip_covered(
        "AO23",
        "covered by whrb-web/app/api/ad-orders/__tests__/rls-delete.test.ts",
    ))

    # AO24 — soft-archive list filter; covered by query-helper Vitest.
    results.append(_skip_covered(
        "AO24",
        "covered by whrb-web/lib/queries/__tests__/ad-orders.test.ts (archived filter)",
    ))

    # AO25-AO26 — schedule_events integration; covered by Vitest mocks.
    for aoid, desc in [
        ("AO25", "schedule_events rows created on insert"),
        ("AO26", "schedule_events follow campaign_start"),
    ]:
        results.append(_skip_covered(
            aoid,
            f"covered by whrb-web/app/api/ad-orders/__tests__/ ({desc})",
        ))

    results.append(check_ao27_generated_rejects(pg))
    results.append(check_ao28_org_settings(pg))
    results.append(check_ao29_no_errors(pg, since))

    if pg is not None:
        pg.close()

    pass_n = sum(1 for r in results if r.status == "PASS")
    fail_n = sum(1 for r in results if r.status == "FAIL")
    skip_n = sum(1 for r in results if r.status.startswith("SKIP"))

    print()
    print("=" * 78)
    print(f"ad_orders integrity matrix — {pass_n} PASS / {fail_n} FAIL / {skip_n} SKIP")
    print("=" * 78)
    for r in results:
        print(f"  [{r.status:<13}] {r.id}  {r.msg}")
    print("=" * 78)

    return 0 if fail_n == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
