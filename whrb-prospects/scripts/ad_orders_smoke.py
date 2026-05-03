#!/usr/bin/env python3
"""End-to-end behavioral smoke test for the ad_orders feature.

Covers the trigger + RLS paths that the integrity matrix marks
SKIP-COVERED — column-level RBAC, paid-lockdown, and the ad_order_amend
RPC — by impersonating real user identities at the Postgres level
(`SET LOCAL role = 'authenticated'` + `SET LOCAL request.jwt.claim.sub
= '<uuid>'`). This is exactly what PostgREST does on every request, so
the assertions below match production behavior.

Steps (each prints PASS/FAIL):

  S1 commission_amount auto-computes via the STORED generated column
  S2 rep cannot flip is_paid (column guard → 42501)
  S3 rep cannot edit total_amount (column guard → 42501)
  S4 salesperson rep can edit notes (allowed field)
  S5 admin can mark paid (lifecycle gate satisfied)
  S6 paid-lockdown denies admin direct UPDATE on locked field
  S7 ad_order_amend RPC bypasses lockdown + writes amendment row
  S8 amendment row is visible in ad_order_amendments

Cleanup runs in `finally` even on failure. Uses a dedicated
``promo_id = 'SMK 9999'`` so it never touches real or fixture data.
"""
from __future__ import annotations

import os
import sys
from decimal import Decimal
from pathlib import Path

import psycopg2
from dotenv import load_dotenv

HERE = Path(__file__).resolve().parent
WHRB = HERE.parent
load_dotenv(WHRB / ".env")

ADMIN_ID = "8a51ea36-35b5-44b7-baff-ca48611bf07f"   # verify-bot@example.com
REP_ID   = "28d6a358-5e03-4662-b2a0-4d9440c6505b"   # stage6a-smoke@example.com
PROMO    = "SMK 9999"

results: list[tuple[str, str, str]] = []  # (id, status, msg)


def add(id_: str, status: str, msg: str) -> None:
    results.append((id_, status, msg))
    print(f"  [{status:<4}] {id_}  {msg}")


def conn_pg():
    ref = os.environ["SUPABASE_PROJECT_REF"]
    pw = os.environ["SUPABASE_DB_PASSWORD"]
    dsn = (
        f"postgresql://postgres.{ref}:{pw}"
        "@aws-1-us-west-2.pooler.supabase.com:5432/postgres?sslmode=require"
    )
    return psycopg2.connect(dsn, connect_timeout=15)


def _act_as(cur, user_id: str) -> None:
    """Impersonate <user_id> for the rest of the current transaction."""
    cur.execute("set local role authenticated")
    cur.execute(f"set local request.jwt.claim.sub = '{user_id}'")


def expect_42501(cur, sql: str, label: str, params: tuple = ()) -> tuple[bool, str]:
    try:
        cur.execute(sql, params)
        cur.connection.rollback()
        return False, "UPDATE was unexpectedly accepted"
    except psycopg2.Error as e:
        msg = (e.pgerror or str(e)).strip().splitlines()[0]
        cur.connection.rollback()
        if e.pgcode == "42501":
            return True, f"denied with 42501: {msg}"
        return False, f"wrong error code {e.pgcode}: {msg}"


def main() -> int:
    conn = conn_pg()
    conn.autocommit = False

    smoke_id: str | None = None

    try:
        # ----------- setup ------------------------------------------------
        # Insert a fresh row as service-role (auth.uid() is null → bypasses).
        # Salesperson is the test rep so we can exercise the column guard
        # from the rep's POV later.
        with conn.cursor() as cur:
            cur.execute(
                """
                insert into public.ad_orders (
                  promo_id, company_name, campaign_start, campaign_end,
                  total_amount, salesperson_id, commission_pct, created_by
                ) values (%s, %s, %s, %s, %s, %s, %s, %s)
                returning id, total_amount, commission_pct, commission_amount
                """,
                (
                    PROMO,
                    "ad_orders smoke test",
                    "2026-09-01",
                    "2026-09-08",
                    Decimal("500.00"),
                    REP_ID,
                    Decimal("15.00"),
                    ADMIN_ID,
                ),
            )
            row = cur.fetchone()
            smoke_id, total, pct, comm = row
        conn.commit()

        print(f"\nSmoke row {smoke_id} ({PROMO}) inserted as service role.\n")
        print("=" * 78)
        print("ad_orders smoke matrix")
        print("=" * 78)

        # ----------- S1: generated column ---------------------------------
        expected_comm = (Decimal(total) * Decimal(pct) / Decimal(100)).quantize(Decimal("0.01"))
        if Decimal(comm) == expected_comm:
            add("S1", "PASS", f"commission_amount = {comm} = {total}×{pct}%/100")
        else:
            add("S1", "FAIL", f"commission_amount={comm} != expected {expected_comm}")

        # ----------- S2: rep cannot flip is_paid (column guard) ----------
        with conn.cursor() as cur:
            _act_as(cur, REP_ID)
            ok, msg = expect_42501(
                cur,
                "update public.ad_orders set is_paid = true, paid_at = now(), invoice_sent_at = '2026-09-02'::date, invoice_number = 'X', client_check_number = 'Y' where id = %s",
                "rep is_paid flip",
                (smoke_id,),
            )
        add("S2", "PASS" if ok else "FAIL", f"rep is_paid flip: {msg}")

        # ----------- S3: rep cannot edit total_amount --------------------
        with conn.cursor() as cur:
            _act_as(cur, REP_ID)
            ok, msg = expect_42501(
                cur,
                "update public.ad_orders set total_amount = 999 where id = %s",
                "rep total_amount edit",
                (smoke_id,),
            )
        add("S3", "PASS" if ok else "FAIL", f"rep total_amount edit: {msg}")

        # ----------- S4: rep CAN edit notes (allowed field) --------------
        with conn.cursor() as cur:
            _act_as(cur, REP_ID)
            try:
                cur.execute(
                    "update public.ad_orders set notes = %s where id = %s returning notes",
                    ("rep-edit smoke test", smoke_id),
                )
                got = cur.fetchone()[0]
                conn.commit()
                if got == "rep-edit smoke test":
                    add("S4", "PASS", f"rep notes edit accepted; notes = {got!r}")
                else:
                    add("S4", "FAIL", f"unexpected notes after update: {got!r}")
            except psycopg2.Error as e:
                conn.rollback()
                add("S4", "FAIL", f"rep notes edit denied: {(e.pgerror or str(e)).splitlines()[0]}")

        # ----------- S5: admin marks paid (full transition) --------------
        with conn.cursor() as cur:
            _act_as(cur, ADMIN_ID)
            try:
                cur.execute(
                    """
                    update public.ad_orders
                       set invoice_number = 'INV-SMK-9999',
                           invoice_sent_at = '2026-09-03'::date,
                           is_paid = true,
                           paid_at = now(),
                           client_check_number = 'CHK-SMK-9999'
                     where id = %s
                     returning is_paid, total_amount, commission_amount
                    """,
                    (smoke_id,),
                )
                ip, tot, com = cur.fetchone()
                conn.commit()
                if ip:
                    add("S5", "PASS", f"admin marked paid; total={tot} commission={com} (auto-recomputed)")
                else:
                    add("S5", "FAIL", "is_paid did not flip")
            except psycopg2.Error as e:
                conn.rollback()
                add("S5", "FAIL", f"admin mark-paid denied: {(e.pgerror or str(e)).splitlines()[0]}")

        # ----------- S6: paid-lockdown denies admin direct UPDATE --------
        with conn.cursor() as cur:
            _act_as(cur, ADMIN_ID)
            ok, msg = expect_42501(
                cur,
                "update public.ad_orders set total_amount = 999 where id = %s",
                "admin direct total_amount on paid row",
                (smoke_id,),
            )
        add("S6", "PASS" if ok else "FAIL", f"paid-lockdown: {msg}")

        # ----------- S7: ad_order_amend bypasses lockdown ----------------
        with conn.cursor() as cur:
            _act_as(cur, ADMIN_ID)
            try:
                cur.execute(
                    "select public.ad_order_amend(%s, %s, %s, %s)",
                    (smoke_id, "total_amount", "550.00", "smoke test: $500 → $550"),
                )
                cur.execute(
                    "select total_amount, commission_amount from public.ad_orders where id = %s",
                    (smoke_id,),
                )
                tot, com = cur.fetchone()
                conn.commit()
                if Decimal(tot) == Decimal("550.00") and Decimal(com) == Decimal("82.50"):
                    add("S7", "PASS", f"amend applied; total_amount={tot} commission_amount={com}")
                else:
                    add("S7", "FAIL", f"amend applied but values wrong: total={tot} comm={com}")
            except psycopg2.Error as e:
                conn.rollback()
                add("S7", "FAIL", f"ad_order_amend RPC failed: {(e.pgerror or str(e)).splitlines()[0]}")

        # ----------- S8: amendment row recorded --------------------------
        with conn.cursor() as cur:
            _act_as(cur, ADMIN_ID)
            cur.execute(
                "select field, old_value, new_value, reason, amended_by "
                "from public.ad_order_amendments where ad_order_id = %s order by amended_at desc limit 1",
                (smoke_id,),
            )
            am = cur.fetchone()
            conn.rollback()
        if am:
            field, old_v, new_v, reason, amender = am
            ok = field == "total_amount" and amender == ADMIN_ID
            status = "PASS" if ok else "FAIL"
            add("S8", status, f"amendment row: field={field} old={old_v} new={new_v} by={amender}")
        else:
            add("S8", "FAIL", "no amendment row found")

    finally:
        # cleanup -----------------------------------------------------------
        if smoke_id is not None:
            try:
                with conn.cursor() as cur:
                    cur.execute(
                        "delete from public.ad_order_amendments where ad_order_id = %s",
                        (smoke_id,),
                    )
                    cur.execute("delete from public.ad_orders where id = %s", (smoke_id,))
                conn.commit()
                print(f"\nCleaned up smoke row {smoke_id}.")
            except Exception as e:
                conn.rollback()
                print(f"\nWARNING: cleanup failed for {smoke_id}: {e}")
        conn.close()

    pn = sum(1 for _, s, _ in results if s == "PASS")
    fn = sum(1 for _, s, _ in results if s == "FAIL")
    print()
    print("=" * 78)
    print(f"smoke matrix — {pn} PASS / {fn} FAIL")
    print("=" * 78)
    return 0 if fn == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
