#!/usr/bin/env python3
"""Stage 1 RLS verifier.

For each of the 10 public tables, run two assertions through supabase-py:
  1) ANON    — a write attempted with the anon key MUST fail (RLS denial).
  2) SERVICE — a write attempted with the service-role key MUST succeed
               (service role bypasses RLS).

Total: 20 assertions. Prints "20/20 pass" on green, lists failures otherwise.

Notes / deviations from the plan's literal wording:
- For `profiles`, INSERT would violate the FK to auth.users (profiles.id
  must reference a real auth user, and the handle_new_auth_user trigger
  already creates the row). We substitute UPDATE as the write operation:
  anon cannot UPDATE any profile (RLS allows only self-update and anon has
  no auth.uid()); service role can UPDATE. This preserves the spirit of
  the test (RLS allows/denies writes correctly).
- For tables with FK dependencies, we pre-create parents via service-role
  setup and tear them down at the end.
"""

from __future__ import annotations

import os
import sys
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from dotenv import load_dotenv
from supabase import Client, create_client

HERE = Path(__file__).resolve().parent
WHRB_PROSPECTS = HERE.parent
load_dotenv(WHRB_PROSPECTS / ".env")

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_ANON_KEY = os.environ["SUPABASE_ANON_KEY"]
SUPABASE_SERVICE_ROLE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]


@dataclass
class Result:
    name: str
    passed: bool
    detail: str = ""


# -------------------------------------------------------------------------
# Fixture: a throwaway auth user + profile + prospect that FK-dependent
# tests can reference. Cleaned up at end.
# -------------------------------------------------------------------------
@dataclass
class Fixtures:
    user_id: str = ""
    user_email: str = ""
    prospect_id: str = ""
    # Ids we've inserted that need cleanup (table -> list of where-clauses).
    cleanup: list[tuple[str, dict]] = field(default_factory=list)


def _setup(service: Client) -> Fixtures:
    fx = Fixtures()
    fx.user_email = f"rls-test-{uuid.uuid4().hex[:8]}@example.invalid"
    # Create a throwaway auth user via the admin API. The on_auth_user_created
    # trigger will create a matching profiles row with role='rep'.
    created = service.auth.admin.create_user(
        {"email": fx.user_email, "email_confirm": True, "password": uuid.uuid4().hex}
    )
    fx.user_id = created.user.id

    # Create a throwaway prospect (FK target for notes + presence tests).
    fx.prospect_id = str(uuid.uuid4())
    service.table("prospects").insert(
        {
            "id": fx.prospect_id,
            "business_key": f"rls-test-{uuid.uuid4().hex[:8]}",
            "company_name": "RLS Test Co",
        }
    ).execute()
    fx.cleanup.append(("prospects", {"id": fx.prospect_id}))
    return fx


def _teardown(service: Client, fx: Fixtures) -> None:
    # Clean up in reverse dependency order.
    for table, where in reversed(fx.cleanup):
        try:
            q = service.table(table).delete()
            for k, v in where.items():
                q = q.eq(k, v)
            q.execute()
        except Exception as e:  # pragma: no cover
            print(f"cleanup warn ({table}): {e}", file=sys.stderr)
    # Remove the throwaway auth user (cascades to profile).
    try:
        service.auth.admin.delete_user(fx.user_id)
    except Exception as e:  # pragma: no cover
        print(f"cleanup warn (auth.users): {e}", file=sys.stderr)


# -------------------------------------------------------------------------
# Assertion helpers
# -------------------------------------------------------------------------
def _expect_fail(fn: Callable[[], object], name: str) -> Result:
    try:
        fn()
    except Exception as e:
        return Result(name, True, f"denied ({e.__class__.__name__})")
    return Result(name, False, "expected failure but write succeeded")


def _expect_ok(fn: Callable[[], object], name: str) -> Result:
    try:
        fn()
    except Exception as e:
        return Result(name, False, f"failed: {e.__class__.__name__}: {e}")
    return Result(name, True, "ok")


# -------------------------------------------------------------------------
# Per-table test payloads. Each returns two callables (anon_fn, service_fn).
# After service_fn succeeds, we record the row in fx.cleanup.
# -------------------------------------------------------------------------
def _tests(anon: Client, service: Client, fx: Fixtures):
    # 1) profiles: UPDATE substitution (see module docstring).
    #    PostgREST returns empty-data 200 when RLS filters an UPDATE to 0 rows
    #    (no exception raised). To fit the "write failed" assertion contract,
    #    we read-back under service role and raise PermissionError when RLS
    #    correctly blocked the write (i.e. display_name did not change to
    #    "anon-attempt"). If the anon write *did* take effect, we return
    #    silently — _expect_fail will then correctly report the failure.
    def profiles_anon():
        anon.table("profiles").update({"display_name": "anon-attempt"}).eq("id", fx.user_id).execute()
        row = service.table("profiles").select("display_name").eq("id", fx.user_id).single().execute()
        if row.data and row.data.get("display_name") == "anon-attempt":
            return  # anon actually modified the row -> test should FAIL
        raise PermissionError("RLS blocked anon update (display_name unchanged)")

    def profiles_service():
        service.table("profiles").update({"display_name": "service-ok"}).eq("id", fx.user_id).execute()

    # 2) prospects
    pk_prospect_service = f"rls-test-{uuid.uuid4().hex[:8]}"

    def prospects_anon():
        anon.table("prospects").insert(
            {"business_key": f"anon-{uuid.uuid4().hex[:8]}", "company_name": "Anon Co"}
        ).execute()

    def prospects_service():
        service.table("prospects").insert(
            {"business_key": pk_prospect_service, "company_name": "Service Test Co"}
        ).execute()
        fx.cleanup.append(("prospects", {"business_key": pk_prospect_service}))

    # 3) prospect_notes — needs prospect + profile.
    def notes_anon():
        anon.table("prospect_notes").insert(
            {"prospect_id": fx.prospect_id, "author_id": fx.user_id, "body": "anon note"}
        ).execute()

    note_id_holder: dict[str, str] = {}

    def notes_service():
        res = (
            service.table("prospect_notes")
            .insert({"prospect_id": fx.prospect_id, "author_id": fx.user_id, "body": "service note"})
            .execute()
        )
        note_id_holder["id"] = res.data[0]["id"]
        fx.cleanup.append(("prospect_notes", {"id": note_id_holder["id"]}))

    # 4) source_config
    src_key_service = f"rls_test_{uuid.uuid4().hex[:6]}"

    def source_config_anon():
        anon.table("source_config").insert(
            {"source_key": f"anon_{uuid.uuid4().hex[:6]}", "enabled": False}
        ).execute()

    def source_config_service():
        service.table("source_config").insert(
            {"source_key": src_key_service, "enabled": False}
        ).execute()
        fx.cleanup.append(("source_config", {"source_key": src_key_service}))

    # 5) pipeline_runs
    run_id_holder: dict[str, str] = {}

    def pipeline_runs_anon():
        anon.table("pipeline_runs").insert({"status": "queued"}).execute()

    def pipeline_runs_service():
        res = service.table("pipeline_runs").insert({"status": "queued"}).execute()
        run_id_holder["id"] = res.data[0]["id"]
        fx.cleanup.append(("pipeline_runs", {"id": run_id_holder["id"]}))

    # 6) event_log
    log_id_holder: dict[str, str] = {}

    def event_log_anon():
        anon.table("event_log").insert(
            {"source": "web_client", "level": "info", "message": "anon attempt"}
        ).execute()

    def event_log_service():
        res = service.table("event_log").insert(
            {"source": "pipeline", "level": "info", "category": "rls_check", "message": "service ok"}
        ).execute()
        log_id_holder["id"] = res.data[0]["id"]
        fx.cleanup.append(("event_log", {"id": log_id_holder["id"]}))

    # 7) feedback
    fb_id_holder: dict[str, str] = {}

    def feedback_anon():
        anon.table("feedback").insert({"body": "anon feedback"}).execute()

    def feedback_service():
        res = service.table("feedback").insert({"body": "service feedback", "author_id": fx.user_id}).execute()
        fb_id_holder["id"] = res.data[0]["id"]
        fx.cleanup.append(("feedback", {"id": fb_id_holder["id"]}))

    # 8) user_preferences
    def prefs_anon():
        anon.table("user_preferences").insert({"user_id": fx.user_id}).execute()

    def prefs_service():
        service.table("user_preferences").insert({"user_id": fx.user_id}).execute()
        fx.cleanup.append(("user_preferences", {"user_id": fx.user_id}))

    # 9) notifications
    notif_id_holder: dict[str, str] = {}

    def notif_anon():
        anon.table("notifications").insert(
            {"recipient_id": fx.user_id, "kind": "assigned"}
        ).execute()

    def notif_service():
        res = service.table("notifications").insert(
            {"recipient_id": fx.user_id, "kind": "assigned"}
        ).execute()
        notif_id_holder["id"] = res.data[0]["id"]
        fx.cleanup.append(("notifications", {"id": notif_id_holder["id"]}))

    # 10) prospect_presence
    def presence_anon():
        anon.table("prospect_presence").insert(
            {"prospect_id": fx.prospect_id, "user_id": fx.user_id}
        ).execute()

    def presence_service():
        service.table("prospect_presence").insert(
            {"prospect_id": fx.prospect_id, "user_id": fx.user_id}
        ).execute()
        fx.cleanup.append(
            ("prospect_presence", {"prospect_id": fx.prospect_id, "user_id": fx.user_id})
        )

    return [
        ("profiles",           profiles_anon,        profiles_service),
        ("prospects",          prospects_anon,       prospects_service),
        ("prospect_notes",     notes_anon,           notes_service),
        ("source_config",      source_config_anon,   source_config_service),
        ("pipeline_runs",      pipeline_runs_anon,   pipeline_runs_service),
        ("event_log",          event_log_anon,       event_log_service),
        ("feedback",           feedback_anon,        feedback_service),
        ("user_preferences",   prefs_anon,           prefs_service),
        ("notifications",      notif_anon,           notif_service),
        ("prospect_presence",  presence_anon,        presence_service),
    ]


def main() -> int:
    anon = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
    service = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    fx = _setup(service)
    results: list[Result] = []
    try:
        for table, anon_fn, service_fn in _tests(anon, service, fx):
            results.append(_expect_fail(anon_fn, f"{table} :: anon-denied"))
            results.append(_expect_ok(service_fn, f"{table} :: service-allowed"))
    finally:
        _teardown(service, fx)

    passed = sum(1 for r in results if r.passed)
    total = len(results)
    width = max(len(r.name) for r in results)
    print("\nResults:")
    for r in results:
        icon = "PASS" if r.passed else "FAIL"
        print(f"  [{icon}] {r.name.ljust(width)}  {r.detail}")
    print(f"\n{passed}/{total} pass")
    return 0 if passed == total else 1


if __name__ == "__main__":
    raise SystemExit(main())
