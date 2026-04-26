#!/usr/bin/env python3
"""Integrity check suite for 010_prospect_contact_emails.sql.

Plants a dedicated test prospect, walks every state-change scenario from
the migration plan's section K (Verification), asserts the integrity
invariants from section I, then cleans up. Exits non-zero on any
failure.

Pre-conditions:
  - 010_prospect_contact_emails.sql applied via
    scripts/apply_multi_email_migration.py.

Usage:
    .venv/bin/python scripts/multi_email_integrity.py
    .venv/bin/python scripts/multi_email_integrity.py --keep-fixture
        # leave the test prospect in place (debugging)

Exit codes:
  0  every invariant green
  1  any invariant failed
  2  pre-flight (schema lookup) failed
"""
from __future__ import annotations

import argparse
import os
import sys
import uuid
from dataclasses import dataclass
from pathlib import Path

import psycopg2
import psycopg2.errors
from dotenv import load_dotenv

HERE = Path(__file__).resolve().parent
WHRB = HERE.parent
load_dotenv(WHRB / ".env")

PROJECT_REF = os.environ["SUPABASE_PROJECT_REF"]
DB_PASSWORD = os.environ["SUPABASE_DB_PASSWORD"]

FIXTURE_BUSINESS_KEY_PREFIX = "010-fixture-"


@dataclass
class T:
    name: str
    passed: bool
    detail: str


def _ok(name: str, detail: str = "") -> T:
    return T(name, True, detail)


def _fail(name: str, detail: str) -> T:
    return T(name, False, detail)


def _conn():
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


# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------


def _scalar_and_count(cur, prospect_id):
    cur.execute(
        "select contact_email, contact_email_count from prospects where id = %s",
        (prospect_id,),
    )
    return cur.fetchone()


def _emails(cur, prospect_id):
    cur.execute(
        "select id, email, is_primary, source from prospect_contact_emails "
        "where prospect_id = %s order by added_at asc, id asc",
        (prospect_id,),
    )
    return cur.fetchall()


def _audit_categories(cur, prospect_id):
    cur.execute(
        "select category from event_log "
        "where context ->> 'prospect_id' = %s "
        "order by created_at asc",
        (str(prospect_id),),
    )
    return [r[0] for r in cur.fetchall()]


def _plant_prospect(cur):
    pid = uuid.uuid4()
    bk = f"{FIXTURE_BUSINESS_KEY_PREFIX}{pid}"
    cur.execute(
        "insert into prospects (id, business_key, company_name) "
        "values (%s, %s, %s)",
        (str(pid), bk, "Multi-email integrity fixture"),
    )
    return pid


def _cleanup(cur):
    cur.execute(
        "delete from prospects where business_key like %s",
        (FIXTURE_BUSINESS_KEY_PREFIX + "%",),
    )


# -----------------------------------------------------------------------------
# Pre-flight
# -----------------------------------------------------------------------------


def _preflight(cur) -> list[T]:
    results: list[T] = []

    cur.execute(
        "select 1 from information_schema.tables "
        "where table_schema='public' and table_name='prospect_contact_emails'"
    )
    if cur.fetchone():
        results.append(_ok("PF1", "prospect_contact_emails table exists"))
    else:
        results.append(_fail("PF1", "prospect_contact_emails table not found"))

    cur.execute(
        "select 1 from information_schema.columns "
        "where table_name='prospects' and column_name='contact_email_count'"
    )
    if cur.fetchone():
        results.append(_ok("PF2", "prospects.contact_email_count column exists"))
    else:
        results.append(
            _fail("PF2", "prospects.contact_email_count column not found")
        )

    cur.execute(
        "select 1 from pg_proc where proname='set_primary_contact_email'"
    )
    if cur.fetchone():
        results.append(_ok("PF3", "set_primary_contact_email RPC exists"))
    else:
        results.append(_fail("PF3", "set_primary_contact_email RPC not found"))

    cur.execute(
        "select tgname from pg_trigger "
        "where tgname in ('t_pce_sync','t_pce_audit','t_pce_enforce',"
        "                 't_prospects_guard_contact_email')"
    )
    found = {r[0] for r in cur.fetchall()}
    expected = {
        "t_pce_sync",
        "t_pce_audit",
        "t_pce_enforce",
        "t_prospects_guard_contact_email",
    }
    if expected.issubset(found):
        results.append(_ok("PF4", f"all 010 triggers attached ({sorted(found)})"))
    else:
        missing = expected - found
        results.append(_fail("PF4", f"missing 010 triggers: {sorted(missing)}"))

    return results


# -----------------------------------------------------------------------------
# Scenario walks (K.1 .. K.10)
# -----------------------------------------------------------------------------


def _scenario_walk(conn) -> list[T]:
    """Walks the scenarios from the migration's section K (Verification)
    inside one transaction; rolls back at the end so no fixture data
    persists. Each step asserts the integrity invariants from section I."""
    results: list[T] = []

    with conn:  # outer transaction
        with conn.cursor() as cur:
            pid = _plant_prospect(cur)

            # K.1 Add email to empty prospect → auto-primary, count=1
            cur.execute(
                "insert into prospect_contact_emails "
                "(prospect_id, email, source) values (%s, %s, %s) returning id",
                (str(pid), "foo@a.com", "manual_rep"),
            )
            foo_id = cur.fetchone()[0]
            scalar, count = _scalar_and_count(cur, str(pid))
            rows = _emails(cur, str(pid))
            if scalar == "foo@a.com" and count == 1 and len(rows) == 1 and rows[0][2]:
                results.append(_ok("K1", "first email auto-promoted to primary"))
            else:
                results.append(
                    _fail("K1", f"scalar={scalar} count={count} rows={rows}")
                )

            # K.2 Add second email → not primary, scalar unchanged
            cur.execute(
                "insert into prospect_contact_emails "
                "(prospect_id, email, source) values (%s, %s, %s) returning id",
                (str(pid), "bar@b.com", "manual_rep"),
            )
            bar_id = cur.fetchone()[0]
            scalar, count = _scalar_and_count(cur, str(pid))
            rows = _emails(cur, str(pid))
            primaries = [r for r in rows if r[2]]
            if (
                scalar == "foo@a.com"
                and count == 2
                and len(primaries) == 1
                and primaries[0][1] == "foo@a.com"
            ):
                results.append(_ok("K2", "second email added as non-primary"))
            else:
                results.append(
                    _fail("K2", f"scalar={scalar} count={count} rows={rows}")
                )

            # K.3 Promote bar to primary via RPC
            cur.execute(
                "select set_primary_contact_email(%s, %s)", (str(pid), bar_id)
            )
            scalar, count = _scalar_and_count(cur, str(pid))
            rows = _emails(cur, str(pid))
            primaries = [r for r in rows if r[2]]
            if (
                scalar == "bar@b.com"
                and count == 2
                and len(primaries) == 1
                and primaries[0][1] == "bar@b.com"
            ):
                results.append(_ok("K3", "RPC primary swap reflected in scalar"))
            else:
                results.append(
                    _fail("K3", f"scalar={scalar} count={count} rows={rows}")
                )

            # K.4 Delete primary (bar) while another exists → foo promoted
            cur.execute(
                "delete from prospect_contact_emails where id = %s", (bar_id,)
            )
            scalar, count = _scalar_and_count(cur, str(pid))
            rows = _emails(cur, str(pid))
            primaries = [r for r in rows if r[2]]
            if (
                scalar == "foo@a.com"
                and count == 1
                and len(primaries) == 1
                and primaries[0][0] == foo_id
            ):
                results.append(
                    _ok("K4", "successor auto-promoted on primary delete")
                )
            else:
                results.append(
                    _fail("K4", f"scalar={scalar} count={count} rows={rows}")
                )

            # K.5 Delete last email → scalar null, count=0
            cur.execute(
                "delete from prospect_contact_emails where id = %s", (foo_id,)
            )
            scalar, count = _scalar_and_count(cur, str(pid))
            rows = _emails(cur, str(pid))
            if scalar is None and count == 0 and rows == []:
                results.append(_ok("K5", "last email delete clears scalar"))
            else:
                results.append(
                    _fail("K5", f"scalar={scalar!r} count={count} rows={rows}")
                )

            # K.6 Duplicate insert (case-insensitive) → unique violation
            cur.execute(
                "insert into prospect_contact_emails "
                "(prospect_id, email, source) values (%s, %s, %s)",
                (str(pid), "dup@x.com", "manual_rep"),
            )
            try:
                cur.execute(
                    "savepoint sp_dup; "
                    "insert into prospect_contact_emails "
                    "(prospect_id, email, source) values (%s, %s, %s)",
                    (str(pid), "DUP@x.com", "manual_rep"),
                )
                results.append(
                    _fail("K6", "case-insensitive duplicate insert was allowed")
                )
                cur.execute("rollback to savepoint sp_dup")
            except psycopg2.errors.UniqueViolation:
                cur.execute("rollback to savepoint sp_dup")
                results.append(
                    _ok("K6", "case-insensitive duplicate rejected (23505)")
                )

            # K.10 Direct scalar write → P0001
            try:
                cur.execute(
                    "savepoint sp_guard; "
                    "update prospects set contact_email = 'oops@oops.com' "
                    "where id = %s",
                    (str(pid),),
                )
                results.append(
                    _fail("K10", "direct scalar write was NOT blocked")
                )
                cur.execute("rollback to savepoint sp_guard")
            except psycopg2.errors.RaiseException as e:
                cur.execute("rollback to savepoint sp_guard")
                if "denormalized" in str(e):
                    results.append(_ok("K10", "guard trigger blocked direct write"))
                else:
                    results.append(_fail("K10", f"unexpected error: {e}"))

            # I7 No orphaned rows: insert two emails, delete prospect, assert
            # cascade. Done in a sub-savepoint so the outer rollback below
            # cleans everything.
            cur.execute("savepoint sp_orphan")
            cur.execute(
                "insert into prospect_contact_emails "
                "(prospect_id, email, source) values (%s, %s, %s), (%s, %s, %s)",
                (
                    str(pid),
                    "a@cascade.com",
                    "manual_rep",
                    str(pid),
                    "b@cascade.com",
                    "manual_rep",
                ),
            )
            cur.execute("delete from prospects where id = %s", (str(pid),))
            cur.execute(
                "select count(*) from prospect_contact_emails where prospect_id = %s",
                (str(pid),),
            )
            remaining = cur.fetchone()[0]
            if remaining == 0:
                results.append(
                    _ok("I7", "FK cascade removed children on parent delete")
                )
            else:
                results.append(
                    _fail("I7", f"{remaining} orphaned rows after parent delete")
                )
            cur.execute("rollback to savepoint sp_orphan")

            # I8 Email format/length: malformed insert → CHECK violation.
            try:
                cur.execute(
                    "savepoint sp_fmt; "
                    "insert into prospect_contact_emails "
                    "(prospect_id, email, source) values (%s, %s, %s)",
                    (str(pid), "no-at-sign", "manual_rep"),
                )
                results.append(_fail("I8", "malformed email was allowed"))
                cur.execute("rollback to savepoint sp_fmt")
            except psycopg2.errors.CheckViolation:
                cur.execute("rollback to savepoint sp_fmt")
                results.append(_ok("I8", "format CHECK rejected malformed email"))

            try:
                cur.execute(
                    "savepoint sp_len; "
                    "insert into prospect_contact_emails "
                    "(prospect_id, email, source) values (%s, %s, %s)",
                    (str(pid), "x" * 250 + "@y.com", "manual_rep"),
                )
                results.append(_fail("I8b", "over-length email was allowed"))
                cur.execute("rollback to savepoint sp_len")
            except psycopg2.errors.CheckViolation:
                cur.execute("rollback to savepoint sp_len")
                results.append(_ok("I8b", "length CHECK rejected >200 chars"))

            # I6 Audit log captures key categories from the walk above.
            cats = _audit_categories(cur, str(pid))
            expected_subset = {
                "prospect_email_added",
                "prospect_email_removed",
                "prospect_email_primary_changed",
            }
            if expected_subset.issubset(set(cats)):
                results.append(
                    _ok("I6", f"audit categories present: {sorted(set(cats))}")
                )
            else:
                missing = expected_subset - set(cats)
                results.append(
                    _fail(
                        "I6",
                        f"missing audit categories: {sorted(missing)}; have {cats}",
                    )
                )

            # I1 (defense-in-depth) Two primaries via direct UPDATE → blocked.
            # Reset to a known state: insert one email which auto-becomes primary.
            cur.execute("savepoint sp_two_primary")
            cur.execute(
                "insert into prospects (id, business_key, company_name) "
                "values (%s, %s, %s)",
                (
                    str(uuid.uuid4()),
                    f"{FIXTURE_BUSINESS_KEY_PREFIX}two_primary_{uuid.uuid4()}",
                    "two_primary fixture",
                ),
            )
            cur.execute(
                "select id from prospects where business_key like %s "
                "order by created_at desc limit 1",
                (f"{FIXTURE_BUSINESS_KEY_PREFIX}two_primary_%",),
            )
            tp_id = cur.fetchone()[0]
            cur.execute(
                "insert into prospect_contact_emails "
                "(prospect_id, email, source) values (%s, %s, %s) returning id",
                (str(tp_id), "p1@x.com", "manual_rep"),
            )
            cur.execute(
                "insert into prospect_contact_emails "
                "(prospect_id, email, source) values (%s, %s, %s) returning id",
                (str(tp_id), "p2@x.com", "manual_rep"),
            )
            p2_id = cur.fetchone()[0]
            try:
                cur.execute(
                    "savepoint sp_promote_direct; "
                    "update prospect_contact_emails set is_primary = true "
                    "where id = %s",
                    (p2_id,),
                )
                results.append(
                    _fail(
                        "I1",
                        "direct UPDATE to second primary was NOT blocked",
                    )
                )
                cur.execute("rollback to savepoint sp_promote_direct")
            except psycopg2.errors.RaiseException as e:
                cur.execute("rollback to savepoint sp_promote_direct")
                if "second primary" in str(e) or "use set_primary" in str(e):
                    results.append(
                        _ok(
                            "I1",
                            "BEFORE trigger blocked direct second-primary UPDATE",
                        )
                    )
                else:
                    results.append(_fail("I1", f"unexpected error: {e}"))
            cur.execute("rollback to savepoint sp_two_primary")

            # Roll back the entire scenario transaction so no fixture
            # data leaks into the dev DB.
            conn.rollback()

    return results


# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--keep-fixture",
        action="store_true",
        help="Skip the cleanup of any leftover 010 fixtures.",
    )
    args = ap.parse_args()

    conn = _conn()
    try:
        # Defensive cleanup of any leftover fixtures from prior aborted runs.
        if not args.keep_fixture:
            with conn, conn.cursor() as cur:
                _cleanup(cur)

        with conn.cursor() as cur:
            preflight = _preflight(cur)
        if any(not t.passed for t in preflight):
            for t in preflight:
                tag = "PASS" if t.passed else "FAIL"
                print(f"[{tag}] {t.name:<6} {t.detail}")
            print("\nPre-flight failed; aborting.")
            return 2

        results = preflight + _scenario_walk(conn)
    finally:
        conn.close()

    n_fail = sum(1 for r in results if not r.passed)
    print()
    print(f"{'Tk':<6} {'result':<6} detail")
    print("-" * 78)
    for r in results:
        tag = "PASS" if r.passed else "FAIL"
        print(f"{r.name:<6} {tag:<6} {r.detail}")
    print()
    print(
        f"Result: {len(results) - n_fail} pass / {n_fail} fail "
        f"({len(results)} total)"
    )
    return 1 if n_fail else 0


if __name__ == "__main__":
    raise SystemExit(main())
