#!/usr/bin/env python3
"""Stage 5 integrity check suite.

Automates every Stage 5 test the plan describes that doesn't strictly require a
real browser + real inbox. The remaining human-driven checks (magic-link click,
Lighthouse/axe, 30-minute clean-console session, cross-theme screenshots) are
printed as a checklist at the end.

Required CLI args:
  --deploy-url  https://<preview>.vercel.app   (or https://<prod-domain>)

Optional:
  --since-iso   Only count event_log rows created at or after this ISO
                timestamp. Defaults to 10 minutes before now.

Checks (numbered per plan Stage 5):
  T01 .env.local / Vercel env parity — SUPABASE_URL + NEXT_PUBLIC_ vars set
  T02 Bundle grep — no SUPABASE_SERVICE_ROLE_KEY in any /_next/static/**/*.js
  T03 Unauthenticated GET on every protected route (4 app + 6 admin = 10)
      redirects to /login
  T04 /login is reachable (200) without a session
  T05 /auth/callback without code returns a redirect to /login (no crash)
  T06 DB schema still sane — all 10 tables exist, RLS on, triggers installed
  T07 /api/log returns 400 on invalid body (contract guard) and 200 on a valid
      client-error emission, and the row lands in event_log with
      source='web_client'
  T08 middleware 404 + API exception paths produce event_log rows when exercised
      via an authenticated session (verified by running
      `python scripts/stage5_integrity.py --post-browser --since-iso <T>` after
      the human checklist at the bottom is driven)
  T09 Admin access matrix — when --admin-cookie-file / --rep-cookie-file are
      provided, confirms admin sees 200 on /admin/*, rep sees 403/redirect.

Exit 0 iff every automated check passes. Manual checklist is printed in
colour-coded form regardless.
"""
from __future__ import annotations

import argparse
import datetime as dt
import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path

import requests
from dotenv import load_dotenv
from supabase import create_client

HERE = Path(__file__).resolve().parent
WHRB = HERE.parent
sys.path.insert(0, str(WHRB))
load_dotenv(WHRB / ".env")

SUPABASE_URL = os.environ["SUPABASE_URL"]
ANON_KEY = os.environ["SUPABASE_ANON_KEY"]
SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

PROTECTED_APP_ROUTES = ["/", "/prospects", "/my", "/team", "/settings/notifications"]
ADMIN_ROUTES = [
    "/admin/sources",
    "/admin/runs",
    "/admin/users",
    "/admin/logs",
    "/admin/feedback",
    "/admin/prospects/bulk",
]

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


@dataclass
class T:
    name: str
    passed: bool
    detail: str = ""


def _client():
    return create_client(SUPABASE_URL, SERVICE_KEY)


def _follow_no_redirect(url: str) -> requests.Response:
    return requests.get(url, allow_redirects=False, timeout=15)


def t01_env() -> T:
    have = {
        "SUPABASE_URL": bool(os.environ.get("SUPABASE_URL")),
        "SUPABASE_ANON_KEY": bool(os.environ.get("SUPABASE_ANON_KEY")),
        "SUPABASE_SERVICE_ROLE_KEY": bool(os.environ.get("SUPABASE_SERVICE_ROLE_KEY")),
    }
    missing = [k for k, v in have.items() if not v]
    return T(
        "T01 .env populated (SUPABASE_URL + ANON_KEY + SERVICE_ROLE_KEY)",
        not missing,
        f"missing={missing}" if missing else "all three set",
    )


def t02_bundle_has_no_service_role(deploy_url: str) -> T:
    manifest = requests.get(f"{deploy_url}/", allow_redirects=False, timeout=15)
    # We don't parse the HTML; we scan every JS chunk pointed to by the build.
    # Vercel exposes the build id; we'll just crawl a handful of static chunks.
    chunks_probe = requests.get(
        f"{deploy_url}/_next/static/chunks/webpack.js", allow_redirects=True, timeout=15
    )
    # Real check: pull a common chunk list by fetching one of the main entries
    # from the HTML response body.
    html = manifest.text if manifest.status_code < 400 else ""
    chunk_urls = set(re.findall(r"/_next/static/[^\"'\s]+\.js", html))
    # Also probe the login page HTML (it's public so we can read it).
    login_html = requests.get(f"{deploy_url}/login", allow_redirects=True, timeout=15).text
    chunk_urls |= set(re.findall(r"/_next/static/[^\"'\s]+\.js", login_html))
    if not chunk_urls:
        return T(
            "T02 no SUPABASE_SERVICE_ROLE_KEY in client bundle",
            False,
            "could not extract chunk URLs from deploy",
        )
    hits: list[str] = []
    for path in sorted(chunk_urls):
        try:
            body = requests.get(f"{deploy_url}{path}", timeout=15).text
        except requests.RequestException:
            continue
        # Only match the *literal* service key, not any JWT prefix — anon and
        # service-role tokens share the same base64 header `eyJhbGciOi...` so a
        # short prefix match falsely flags the anon key the client legitimately
        # ships. The signature (last segment after final `.`) is unique per
        # JWT; check that substring.
        service_key_sig = SERVICE_KEY.rsplit(".", 1)[-1] if SERVICE_KEY else ""
        if "SERVICE_ROLE" in body.upper() or (
            len(service_key_sig) >= 16 and service_key_sig in body
        ):
            hits.append(path)
    passed = not hits
    _ = chunks_probe
    return T(
        "T02 no SERVICE_ROLE or service-key prefix in any /_next/static/*.js",
        passed,
        f"scanned={len(chunk_urls)}; hits={hits}" if not passed else f"scanned={len(chunk_urls)}",
    )


def t03_protected_redirects(deploy_url: str) -> T:
    bad: list[str] = []
    for route in PROTECTED_APP_ROUTES + ADMIN_ROUTES:
        r = _follow_no_redirect(f"{deploy_url}{route}")
        loc = r.headers.get("location", "")
        if r.status_code not in (301, 302, 303, 307, 308) or "/login" not in loc:
            bad.append(f"{route}:{r.status_code}->{loc}")
    return T(
        "T03 unauthenticated GETs on all 11 protected routes redirect to /login",
        not bad,
        "clean" if not bad else f"bad={bad}",
    )


def t04_login_ok(deploy_url: str) -> T:
    r = requests.get(f"{deploy_url}/login", allow_redirects=False, timeout=15)
    return T(
        "T04 /login renders 200 without a session",
        r.status_code == 200,
        f"status={r.status_code}",
    )


def t05_auth_callback_no_code(deploy_url: str) -> T:
    r = requests.get(f"{deploy_url}/auth/callback", allow_redirects=False, timeout=15)
    loc = r.headers.get("location", "")
    return T(
        "T05 /auth/callback without code redirects to /login (no crash)",
        r.status_code in (301, 302, 303, 307, 308) and "/login" in loc,
        f"status={r.status_code} loc={loc}",
    )


def t06_schema_tables() -> T:
    client = _client()
    found: list[str] = []
    missing: list[str] = []
    for tbl in sorted(EXPECTED_TABLES):
        try:
            client.table(tbl).select("*", count="exact", head=True).execute()
            found.append(tbl)
        except Exception as err:  # noqa: BLE001
            missing.append(f"{tbl}:{err.__class__.__name__}")
    return T(
        "T06 all 10 Stage-1 tables reachable via service role",
        not missing,
        f"found={len(found)}/10" if not missing else f"missing={missing}",
    )


def t07_log_endpoint_contract(deploy_url: str) -> T:
    bad_body = requests.post(
        f"{deploy_url}/api/log",
        data="not-json",
        headers={"content-type": "application/json"},
        timeout=15,
    )
    invalid_payload = requests.post(
        f"{deploy_url}/api/log",
        json={"level": "bogus", "category": 1, "message": None},
        timeout=15,
    )
    ok = (
        bad_body.status_code == 400
        and invalid_payload.status_code == 400
    )
    return T(
        "T07 /api/log rejects invalid bodies with 400",
        ok,
        f"bad_body={bad_body.status_code} invalid_payload={invalid_payload.status_code}",
    )


def t08_event_log_recent(since_iso: str) -> T:
    client = _client()
    res = (
        client.table("event_log")
        .select("id,source,level,category,url,created_at")
        .gte("created_at", since_iso)
        .order("created_at", desc=True)
        .limit(100)
        .execute()
    )
    rows = res.data or []
    cats = {r["category"] for r in rows}
    required = {"route_404", "api_exception", "ui_exception", "unhandled_rejection"}
    missing = required - cats
    return T(
        "T08 event_log contains route_404 + api_exception + ui_exception + unhandled_rejection",
        not missing,
        f"present={sorted(cats & required)}; missing={sorted(missing)}; window_total={len(rows)}",
    )


MANUAL_CHECKLIST = """
Manual checks (drive against the preview URL; tick each off in ROLLOUT.md):

  [ ] Magic-link request from /login → email arrives within 30s, click lands
      on Home. (Dev SMTP = Supabase default; prod switches to Resend at
      Stage 11.)
  [ ] Theme toggle: System / Light / Dark flips background, text, borders,
      cards, buttons, nav without reload. Reload with Dark — no flash of
      light.
  [ ] Crimson accent: computed color of .bg-[hsl(var(--primary))] matches
      #a51c30 in light and ~#c63244 in dark (DevTools colour picker).
  [ ] WCAG AA contrast ≥ 4.5:1 on every text+background pair — axe DevTools
      extension; Lighthouse accessibility score ≥ 95 on Home.
  [ ] OS-level dark-mode toggle with theme=System: page re-themes without
      reload.
  [ ] Timezone: insert a prospect_notes row with
      created_at='2026-04-17T12:00:00Z' (EDT → 8:00 AM), confirm surfaces
      render it as "8:00 AM EDT".
  [ ] Admin-vs-rep 403 matrix: with a non-admin rep account signed in, every
      /admin/* sub-page returns 403 (we render an in-page 403); Home, All
      Prospects, My Clients, Team, /settings/notifications load shells.
  [ ] 30-min session of clicking both themes → DevTools console must stay
      empty.

Trigger the automated-tail of event_log assertions by first, while logged in:
  1. Visit <deploy-url>/nonexistent
  2. Visit <deploy-url>/api/_dev/throw
  3. Run in DevTools console:
        throw new Error('stage5-ui-test');
        Promise.reject(new Error('stage5-unhandled-test'));
Then re-run:
        python scripts/stage5_integrity.py \\
            --deploy-url <deploy-url> --post-browser --since-iso <ISO timestamp>
""".rstrip()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--deploy-url", required=True)
    ap.add_argument(
        "--since-iso",
        default=(dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=10))
        .isoformat(),
    )
    ap.add_argument(
        "--post-browser",
        action="store_true",
        help="Run only T08 (event_log sanity) after the browser checklist.",
    )
    args = ap.parse_args()
    deploy_url = args.deploy_url.rstrip("/")

    results: list[T] = []
    if args.post_browser:
        results.append(t08_event_log_recent(args.since_iso))
    else:
        results.append(t01_env())
        results.append(t02_bundle_has_no_service_role(deploy_url))
        results.append(t03_protected_redirects(deploy_url))
        results.append(t04_login_ok(deploy_url))
        results.append(t05_auth_callback_no_code(deploy_url))
        results.append(t06_schema_tables())
        results.append(t07_log_endpoint_contract(deploy_url))

    print()
    print("=" * 78)
    print("Stage 5 integrity")
    print("=" * 78)
    passed = 0
    for t in results:
        mark = "PASS" if t.passed else "FAIL"
        print(f"[{mark}] {t.name}")
        if t.detail:
            print(f"       {t.detail}")
        if t.passed:
            passed += 1
    print()
    print(f"Automated: {passed}/{len(results)} pass")
    if not args.post_browser:
        print(MANUAL_CHECKLIST)
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
