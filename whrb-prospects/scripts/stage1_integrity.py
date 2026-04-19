#!/usr/bin/env python3
"""Stage 1 integrity check suite — runs every test from the plan's Stage 1 list
and reports pass/fail.

Order follows the plan's Stage 1 'Integrity tests' bullet list:
  T01  10 public tables
  T02  every table appears in pg_policies, >=18 total policies
  T03  required triggers on prospects / prospect_notes / source_config / user_preferences
  T04  on_auth_user_created trigger on auth.users
  T05  exactly 1 admin profile (kingyareh@gmail.com)
  T06  trigger smoke: insert+update a prospect -> event_log prospect_state_change
  T07  invite trigger smoke: create auth user -> profiles row appears with role='rep'
  T08  check constraints enforce enum columns (state='not_a_state' rejected)
  T09  all 5 prospects indexes exist
  T10  rls_check.py: 20/20 pass
"""

from __future__ import annotations

import json
import os
import subprocess
import uuid
from dataclasses import dataclass
from pathlib import Path

import psycopg2
import psycopg2.extras
from dotenv import load_dotenv
from supabase import create_client

HERE = Path(__file__).resolve().parent
WHRB_PROSPECTS = HERE.parent
load_dotenv(WHRB_PROSPECTS / ".env")

SUPABASE_URL = os.environ["SUPABASE_URL"]
SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]


@dataclass
class T:
    name: str
    passed: bool
    detail: str


def _conn():
    project_ref = os.environ["SUPABASE_PROJECT_REF"]
    password = os.environ["SUPABASE_DB_PASSWORD"]
    dsn = f"postgresql://postgres:{password}@db.{project_ref}.supabase.co:5432/postgres?sslmode=require"
    return psycopg2.connect(dsn, connect_timeout=10)


def _fetch(cur, sql: str, *args):
    cur.execute(sql, args)
    return cur.fetchall()


# -------------------------------------------------------------------------
EXPECTED_TABLES = {
    "profiles",
    "prospects",
    "prospect_notes",
    "source_config",
    "pipeline_runs",
    "event_log",
    "feedback",
    "user_preferences",
    "notifications",
    "prospect_presence",
}


def t01_tables(cur) -> T:
    rows = _fetch(
        cur,
        "select table_name from information_schema.tables "
        "where table_schema='public' and table_type='BASE TABLE'",
    )
    found = {r[0] for r in rows}
    missing = EXPECTED_TABLES - found
    extra = found - EXPECTED_TABLES
    passed = not missing and len(found & EXPECTED_TABLES) == 10
    detail = f"found={len(found)} missing={missing or 'none'} extra={extra or 'none'}"
    return T("T01 10 public tables", passed, detail)


def t02_policies(cur) -> T:
    rows = _fetch(cur, "select tablename, policyname from pg_policies where schemaname='public'")
    per_table: dict[str, int] = {}
    for tbl, _pol in rows:
        per_table[tbl] = per_table.get(tbl, 0) + 1
    covered = set(per_table.keys())
    missing_tables = EXPECTED_TABLES - covered
    total = sum(per_table.values())
    passed = total >= 18 and not missing_tables
    detail = f"total={total} per_table={per_table} missing={missing_tables or 'none'}"
    return T("T02 >=18 policies, every table covered", passed, detail)


REQUIRED_TRIGGERS = {
    "t_prospects_updated_at",
    "t_prospects_audit",
    "t_notes_edited_at",
    "t_source_config_updated_at",
    "t_user_preferences_updated_at",
}


def t03_triggers(cur) -> T:
    rows = _fetch(
        cur,
        "select tgname from pg_trigger where tgrelid in "
        "('public.prospects'::regclass, 'public.prospect_notes'::regclass, "
        " 'public.source_config'::regclass, 'public.user_preferences'::regclass) "
        "and not tgisinternal",
    )
    found = {r[0] for r in rows}
    missing = REQUIRED_TRIGGERS - found
    passed = not missing
    return T("T03 required public-table triggers", passed, f"found={found} missing={missing or 'none'}")


def t04_auth_trigger(cur) -> T:
    rows = _fetch(
        cur,
        "select tgname from pg_trigger where tgrelid='auth.users'::regclass and not tgisinternal",
    )
    names = {r[0] for r in rows}
    passed = "on_auth_user_created" in names
    return T("T04 on_auth_user_created on auth.users", passed, f"found={names}")


def t05_admin(cur) -> T:
    rows = _fetch(cur, "select count(*) from public.profiles where role='admin'")
    n = rows[0][0]
    rows2 = _fetch(
        cur,
        "select email from public.profiles where role='admin'",
    )
    emails = [r[0] for r in rows2]
    passed = n == 1 and emails == ["kingyareh@gmail.com"]
    return T("T05 exactly 1 admin (kingyareh@gmail.com)", passed, f"count={n} emails={emails}")


def t06_trigger_smoke(cur, conn) -> T:
    # Insert a prospect, update its state, verify event_log row.
    bk = f"smoke-{uuid.uuid4().hex[:8]}"
    try:
        cur.execute(
            "insert into public.prospects (business_key, company_name, state) "
            "values (%s, 'Trigger Smoke', 'researching') returning id",
            (bk,),
        )
        pid = cur.fetchone()[0]
        cur.execute(
            "update public.prospects set state='dead' where id=%s",
            (pid,),
        )
        conn.commit()
        # Now check event_log
        cur.execute(
            "select context from public.event_log "
            "where category='prospect_state_change' "
            "and context->>'prospect_id' = %s "
            "order by created_at desc limit 1",
            (str(pid),),
        )
        row = cur.fetchone()
        if not row:
            return T("T06 audit trigger emits state-change event", False, "no event_log row found")
        ctx = row[0]
        if isinstance(ctx, str):
            ctx = json.loads(ctx)
        ok = ctx.get("field") == "state" and ctx.get("old") == "researching" and ctx.get("new") == "dead"
        detail = f"event ctx={ctx}"
        # cleanup
        cur.execute("delete from public.event_log where context->>'prospect_id' = %s", (str(pid),))
        cur.execute("delete from public.prospects where id=%s", (pid,))
        conn.commit()
        return T("T06 audit trigger emits state-change event", ok, detail)
    except Exception as e:
        conn.rollback()
        return T("T06 audit trigger emits state-change event", False, f"exception: {e}")


def t07_invite_trigger(cur, conn) -> T:
    # Create an auth user via admin API; verify profiles row appears; cleanup.
    service = create_client(SUPABASE_URL, SERVICE_KEY)
    email = f"rls-invite-{uuid.uuid4().hex[:8]}@example.invalid"
    user_id = None
    try:
        res = service.auth.admin.create_user(
            {"email": email, "email_confirm": True, "password": uuid.uuid4().hex}
        )
        user_id = res.user.id
        # Fresh txn read
        conn.rollback()
        cur.execute("select role from public.profiles where id=%s", (user_id,))
        row = cur.fetchone()
        if not row:
            return T("T07 invite trigger creates profile", False, f"no profile row for {email}")
        ok = row[0] == "rep"
        return T("T07 invite trigger creates profile", ok, f"role={row[0]}")
    except Exception as e:
        return T("T07 invite trigger creates profile", False, f"exception: {e}")
    finally:
        if user_id:
            try:
                service.auth.admin.delete_user(user_id)
            except Exception:
                pass


def t08_check_constraint(cur, conn) -> T:
    # Attempt an invalid state value; must be rejected.
    bk = f"chk-{uuid.uuid4().hex[:8]}"
    try:
        cur.execute(
            "insert into public.prospects (business_key, company_name, state) values (%s, 'x', 'not_a_state')",
            (bk,),
        )
        conn.commit()
        cur.execute("delete from public.prospects where business_key=%s", (bk,))
        conn.commit()
        return T("T08 check constraint on prospects.state", False, "invalid state insert unexpectedly succeeded")
    except psycopg2.errors.CheckViolation:
        conn.rollback()
        return T("T08 check constraint on prospects.state", True, "CheckViolation raised as expected")
    except Exception as e:
        conn.rollback()
        return T("T08 check constraint on prospects.state", False, f"unexpected: {e}")


EXPECTED_INDEXES = {
    "idx_prospects_tier_score",
    "idx_prospects_score",
    "idx_prospects_assigned",
    "idx_prospects_state",
    "idx_prospects_zip",
}


def t09_indexes(cur) -> T:
    rows = _fetch(
        cur,
        "select indexname from pg_indexes where schemaname='public' and tablename='prospects'",
    )
    found = {r[0] for r in rows}
    missing = EXPECTED_INDEXES - found
    passed = not missing
    return T("T09 all 5 prospects indexes", passed, f"found={found} missing={missing or 'none'}")


def t10_rls_check() -> T:
    res = subprocess.run(
        [str(WHRB_PROSPECTS / ".venv/bin/python"), str(HERE / "rls_check.py")],
        capture_output=True,
        text=True,
    )
    tail = (res.stdout or "").strip().splitlines()[-1:] if res.stdout else []
    ok = res.returncode == 0 and any("20/20 pass" in l for l in tail)
    detail = (tail[0] if tail else "(no output)") + (" | stderr: " + res.stderr[:120] if res.stderr else "")
    return T("T10 rls_check.py 20/20", ok, detail)


# -------------------------------------------------------------------------
def main() -> int:
    conn = _conn()
    with conn, conn.cursor() as cur:
        results = [
            t01_tables(cur),
            t02_policies(cur),
            t03_triggers(cur),
            t04_auth_trigger(cur),
            t05_admin(cur),
            t06_trigger_smoke(cur, conn),
            t07_invite_trigger(cur, conn),
            t08_check_constraint(cur, conn),
            t09_indexes(cur),
        ]
    # T10 runs a subprocess and manages its own connections; outside the txn.
    results.append(t10_rls_check())
    conn.close()

    print("\nStage 1 integrity results:")
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
