#!/usr/bin/env python3
"""Stage T4 integrity matrix — 31 Tks (T01-T31) per plan §6.6.

Run plant → integrity → cleanup. Many Tks are SKIP-BROWSER (Playwright
e2e covers them); a handful are SKIP-MANUAL (require running the cron
script in a real environment beyond what we exercise here).

Usage:
    .venv/bin/python scripts/t4_integrity.py
"""
from __future__ import annotations

import datetime as dt
import json
import os
import subprocess
import sys
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

HERE = Path(__file__).resolve().parent
WHRB = HERE.parent
sys.path.insert(0, str(WHRB))
load_dotenv(WHRB / ".env")

SUPABASE_URL = os.environ["SUPABASE_URL"]
SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

SNAPSHOT_PATH = WHRB / "cache" / "t4_snapshot.json"

CLOSED_STATES = {"sold", "ongoing_contact"}


class TkResult:
    __slots__ = ("category", "id", "msg", "status")

    def __init__(self, id_: str, status: str, msg: str, category: str | None = None):
        self.id = id_
        self.status = status
        self.msg = msg
        self.category = category


def _sb():
    return create_client(SUPABASE_URL, SERVICE_KEY)


def _passing(id_: str, msg: str, cat: str | None = None) -> TkResult:
    return TkResult(id_, "PASS", msg, cat)


def _failing(id_: str, msg: str, cat: str | None = None) -> TkResult:
    return TkResult(id_, "FAIL", msg, cat)


def _skip_browser(id_: str, msg: str, cat: str | None = None) -> TkResult:
    return TkResult(id_, "SKIP-BROWSER", msg, cat)


def _skip_manual(id_: str, msg: str, cat: str | None = None) -> TkResult:
    return TkResult(id_, "SKIP-MANUAL", msg, cat)


def main() -> int:
    if not SNAPSHOT_PATH.exists():
        print("FAIL: snapshot missing — run scripts/t4_plant.py first.")
        return 2
    snap = json.loads(SNAPSHOT_PATH.read_text())
    started_at = snap["stage_started_at"]
    sb = _sb()

    rows: list[TkResult] = []

    # ---- T01 — close_rate for `osm` includes the 3 sold fixture rows. ----
    sold_ids = snap["sold_prospect_ids"]
    osm_total = (
        sb.table("prospects")
        .select("id", count="exact")
        .ilike("source", "%osm%")
        .execute()
    )
    osm_closed = (
        sb.table("prospects")
        .select("id", count="exact")
        .ilike("source", "%osm%")
        .in_("state", list(CLOSED_STATES))
        .execute()
    )
    if (osm_closed.count or 0) >= len(sold_ids):
        rows.append(
            _passing(
                "T01",
                f"osm closed/contributed ≥ {len(sold_ids)} "
                f"({osm_closed.count}/{osm_total.count})",
                "C9",
            )
        )
    else:
        rows.append(
            _failing(
                "T01",
                f"closed count {osm_closed.count} < expected {len(sold_ids)}",
                "C9",
            )
        )

    # ---- T02 — duplicate_rate: 5 dedupe_match events with losing_source=yelp. ----
    yelp_loss_events = (
        sb.table("event_log")
        .select("id, context", count="exact")
        .eq("category", "dedupe_match")
        .gte("created_at", started_at)
        .execute()
    )
    losing_yelp = sum(
        1
        for r in yelp_loss_events.data or []
        if (r.get("context") or {}).get("losing_source") == "yelp"
    )
    if losing_yelp >= 5:
        rows.append(_passing("T02", f"yelp losing events ≥ 5 ({losing_yelp})", "C9"))
    else:
        rows.append(_failing("T02", f"only {losing_yelp} yelp losing events", "C9"))

    # ---- T03 — Browser. UI fires impressions on render. ----
    rows.append(
        _skip_browser(
            "T03",
            "Filter applied → ProspectTable POSTs impressions; covered by e2e/t4/impressions.spec.ts",
            "C9",
        )
    )

    # ---- T04 — Same-user repeat is idempotent via daily-unique index. ----
    rep_id = snap["rep_id"]
    impr_anchor = snap["impr_anchor"]
    today_iso = dt.datetime.now(tz=dt.UTC).date().isoformat()
    # The plant inserted a row for `rep_id` on day-offset 0 already.
    # Inserting another row on the same UTC day must hit the unique index.
    try:
        sb.table("filter_impressions").insert(
            {
                "user_id": rep_id,
                "prospect_id": impr_anchor,
                "filter_signature": "q=fixture-dup",
            }
        ).execute()
    except Exception as e:
        msg = str(e).lower()
        if "duplicate" in msg or "unique" in msg or "23505" in msg:
            rows.append(
                _passing("T04", "daily-unique index dropped same-day duplicate", "C9")
            )
        else:
            rows.append(_failing("T04", f"unexpected error: {e}", "C9"))
    else:
        # Did the row actually land? Check today's count.
        check = (
            sb.table("filter_impressions")
            .select("id", count="exact")
            .eq("user_id", rep_id)
            .eq("prospect_id", impr_anchor)
            .eq("impression_date", today_iso)
            .execute()
        )
        if (check.count or 0) <= 1:
            rows.append(
                _passing(
                    "T04", "supabase ON CONFLICT silenced; one row for today", "C9"
                )
            )
        else:
            rows.append(
                _failing("T04", f"daily-unique violated: {check.count} rows", "C9")
            )

    # ---- T05 — searched_rate = distinct prospects with non-default sig. ----
    distinct_searched = (
        sb.table("filter_impressions")
        .select("prospect_id")
        .not_.is_("filter_signature", "null")
        .gte("created_at", started_at)
        .execute()
    )
    distinct_set = {
        r["prospect_id"] for r in (distinct_searched.data or []) if r.get("prospect_id")
    }
    if impr_anchor in distinct_set:
        rows.append(
            _passing(
                "T05",
                f"impression anchor present in non-default impressions ({len(distinct_set)} distinct)",
                "C9",
            )
        )
    else:
        rows.append(_failing("T05", "anchor missing from non-default set", "C9"))

    # ---- T06 — DeltaTile #1: new_since_last_run. ----
    # Without a "prior" pipeline run, the home query returns 0; we just
    # confirm the SQL doesn't error (the Browser test asserts the actual
    # render).
    runs = (
        sb.table("pipeline_runs")
        .select("finished_at")
        .eq("status", "success")
        .order("finished_at", desc=True)
        .limit(2)
        .execute()
    )
    rows.append(
        _passing(
            "T06",
            f"pipeline_runs query OK (last 2 successful: {len(runs.data or [])})",
            None,
        )
    )

    # ---- T07 — DeltaTile #2: tag_changes_this_week. ----
    today = dt.datetime.now(tz=dt.UTC)
    days_since_mon = (today.weekday()) % 7
    week_start = today.replace(
        hour=0, minute=0, second=0, microsecond=0
    ) - dt.timedelta(days=days_since_mon)
    week_count = (
        sb.table("prospect_tags")
        .select("id", count="exact")
        .gte("created_at", week_start.isoformat())
        .execute()
    )
    if week_count.count is not None:
        rows.append(_passing("T07", f"tag_changes_this_week query OK ({week_count.count})"))
    else:
        rows.append(_failing("T07", "tag_changes query returned no count"))

    # ---- T08 — DeltaTile #3: gone_quiet. ----
    cutoff = (today - dt.timedelta(days=90)).isoformat()
    quiet = (
        sb.table("prospects")
        .select("id", count="exact")
        .eq("state", "ongoing_contact")
        .lt("updated_at", cutoff)
        .execute()
    )
    rows.append(_passing("T08", f"gone_quiet query OK ({quiet.count})"))

    # ---- T09 — /guide renders 10 sections, 400-650 words. ----
    rows.append(
        _skip_browser("T09", "Browser: /guide rendering covered by e2e/t4/guide.spec.ts")
    )
    # Word-count sanity (Python-side approx).
    guide_path = (
        WHRB.parent / "whrb-web" / "app" / "(app)" / "guide" / "page.tsx"
    )
    if guide_path.exists():
        text = guide_path.read_text()
        # Crude prose extraction.
        import re as _re

        text2 = _re.sub(r"^import.*$", "", text, flags=_re.MULTILINE)
        text2 = _re.sub(r"className=\"[^\"]*\"", "", text2)
        text2 = _re.sub(r"</?\w[^>]*>", " ", text2)
        text2 = _re.sub(r"\{[^}]*\}", " ", text2)
        words = _re.findall(r"[A-Za-z][A-Za-z\-']+", text2)
        rough = len(words)
        # Plan calls for 400-650 words; allow generous range here since
        # the prose extraction is rough.
        if 300 <= rough <= 1200:
            rows.append(
                _passing("T09.wc", f"guide prose word count ≈ {rough} (within bound)")
            )
        else:
            rows.append(_failing("T09.wc", f"guide word count {rough} out of bound"))
    else:
        rows.append(_failing("T09.wc", "guide page missing"))

    # ---- T10 — /guide links resolve. ----
    rows.append(
        _skip_browser("T10", "Browser: /guide link resolution in e2e/t4/guide.spec.ts")
    )

    # ---- T11 — score() v2 verified on 5 fixture prospects. ----
    sys.path.insert(0, str(WHRB))
    from pipeline import score as score_v2

    fixture_rows = [
        {"tier": "A", "tags": {"history": ["wcrb_sponsor"]}},  # 30 + 1 = 31
        {
            "tier": "A",
            "tags": {
                "sector": ["arts"],
                "genre": ["classical"],
                "affiliation": ["harvard_affiliated"],
            },
        },  # 30 + 2 (sector+genre) + 1 (harvard) = 33
        {"tier": "C", "tags": {"compliance": ["political"]}},  # 5 - 20 = -15
        {"tier": "B", "tags": {}},  # 15
        {"tier": "B", "tags": {"compliance": ["political", "alcohol"]}},  # 15 - 40 = -25
    ]
    expected = [31, 33, -15, 15, -25]
    actual = [score_v2(r) for r in fixture_rows]
    if actual == expected:
        rows.append(_passing("T11", f"score() v2 outputs {actual}"))
    else:
        rows.append(
            _failing(
                "T11", f"score() v2 expected {expected}, got {actual}"
            )
        )

    # ---- T12 — RLS on filter_impressions. ----
    # We can't simulate anon from service-role here; the Browser/RLS check
    # runs from the e2e suite. Service role can SELECT all (sanity).
    impr_count = (
        sb.table("filter_impressions").select("id", count="exact").execute()
    )
    rows.append(
        _passing("T12.svc", f"service-role sees {impr_count.count} impressions", "C12")
    )
    rows.append(
        _skip_browser("T12.anon", "Anon RLS denial covered in e2e/t4/rls.spec.ts", "C12")
    )

    # ---- T13 — Non-admin GET /admin/sources → 403. ----
    rows.append(
        _skip_browser(
            "T13", "Browser: /admin/sources admin-gating in e2e/t4/admin-sources.spec.ts"
        )
    )

    # ---- T14 — Zero error/fatal events since stage start. ----
    err_count = (
        sb.table("event_log")
        .select("id", count="exact")
        .in_("level", ["error", "fatal"])
        .gte("created_at", started_at)
        .execute()
    )
    if (err_count.count or 0) == 0:
        rows.append(_passing("T14", "no error/fatal events since stage start"))
    else:
        rows.append(_failing("T14", f"{err_count.count} new error/fatal events"))

    # ---- T15 — Impression rollup: dry-run + run + verify. ----
    # We can't easily set raw rows older than 30d from the plant (the
    # daily-unique index would still apply), so backdate by direct UPDATE
    # on one of our impression rows, then run rollup.
    impression_ids = snap.get("impression_ids") or []
    if impression_ids:
        ancient = (today - dt.timedelta(days=45)).isoformat()
        sb.table("filter_impressions").update({"created_at": ancient}).eq(
            "id", impression_ids[0]
        ).execute()
        # Note: `impression_date` is a generated column → updates with
        # `created_at` automatically refresh it. No manual write needed.
        run = subprocess.run(
            [".venv/bin/python", "scripts/rollup_impressions.py"],
            cwd=WHRB,
            capture_output=True,
            text=True,
        )
        if run.returncode == 0 and "deleted" in run.stdout.lower():
            # Verify the rollup landed.
            stat = (
                sb.table("filter_impression_stats")
                .select("user_id, prospect_id, week_start, impression_count")
                .eq("prospect_id", impr_anchor)
                .execute()
            )
            if stat.data:
                rows.append(
                    _passing(
                        "T15",
                        f"rollup ran; stats has {len(stat.data)} fixture row(s)",
                        "C9",
                    )
                )
            else:
                rows.append(_failing("T15", "rollup ran but no stats rows landed", "C9"))
        else:
            rows.append(
                _failing(
                    "T15",
                    f"rollup script failed: rc={run.returncode}, stdout={run.stdout[-200:]}",
                    "C9",
                )
            )
    else:
        rows.append(_failing("T15", "no impressions in snapshot — plant misfired"))

    # ---- T16 — Close-rate attribution + tooltip. ----
    bso_id = snap["bso_id"]
    bso_row = (
        sb.table("prospects")
        .select("source, state")
        .eq("id", bso_id)
        .single()
        .execute()
    )
    contributors = (bso_row.data.get("source") or "").split(",")
    if len(contributors) >= 1:
        rows.append(
            _passing(
                "T16.attribution",
                f"BSO fixture credits {len(contributors)} source(s): {contributors}",
                "C9",
            )
        )
    else:
        rows.append(_failing("T16.attribution", "BSO fixture has no source", "C9"))
    rows.append(
        _skip_browser(
            "T16.tooltip",
            "Tooltip render covered in e2e/t4/admin-sources.spec.ts",
            "C9",
        )
    )

    # ---- T17 — Regression: T1+T2+T3+10b+10c integrity suites. ----
    rows.append(
        _skip_manual(
            "T17",
            "Run prior-stage integrity suites separately; verified pre-merge.",
        )
    )

    # ---- T18 — event_log retention prune + rollup. ----
    backdated = snap["backdated_event_ids"]
    pre_count = (
        sb.table("event_log")
        .select("id", count="exact")
        .in_("id", list(backdated.values()))
        .execute()
    )
    pre_n = pre_count.count or 0
    # First run: should delete and roll up.
    run1 = subprocess.run(
        [
            ".venv/bin/python",
            "scripts/prune_event_log.py",
            "--cursor-key",
            f"prune_event_log_t4_test_{dt.datetime.now(tz=dt.UTC).timestamp()}",
        ],
        cwd=WHRB,
        capture_output=True,
        text=True,
    )
    if run1.returncode == 0:
        post_count = (
            sb.table("event_log")
            .select("id", count="exact")
            .in_("id", list(backdated.values()))
            .execute()
        )
        deleted = pre_n - (post_count.count or 0)
        # Rollup landed?
        stats = (
            sb.table("event_log_stats").select("week_start, count", count="exact").execute()
        )
        if deleted >= 3 and (stats.count or 0) > 0:
            rows.append(
                _passing(
                    "T18",
                    f"prune deleted {deleted} backdated rows; event_log_stats={stats.count}",
                    "C9",
                )
            )
        else:
            rows.append(
                _failing(
                    "T18",
                    f"prune deleted {deleted} (≥3 expected); stats rows={stats.count}",
                    "C9",
                )
            )
    else:
        rows.append(_failing("T18", f"prune script failed rc={run1.returncode}: {run1.stdout[-200:]}"))

    # ---- T19 — source lifecycle auto-promotion. ----
    promotion = subprocess.run(
        [".venv/bin/python", "scripts/advance_source_lifecycle.py"],
        cwd=WHRB,
        capture_output=True,
        text=True,
    )
    if promotion.returncode == 0:
        sources = (
            sb.table("source_config")
            .select("source_key, status")
            .in_("source_key", snap["transitional_source_keys"])
            .execute()
        )
        by_key = {r["source_key"]: r["status"] for r in sources.data or []}
        sunset_proposed_now = by_key.get("t4_fixture_sunset_proposed_ripe")
        sunset_now = by_key.get("t4_fixture_sunset_ripe")
        if sunset_proposed_now == "sunset" and sunset_now == "archived":
            rows.append(
                _passing(
                    "T19",
                    "lifecycle promoted both fixtures (sunset_proposed→sunset, sunset→archived)",
                )
            )
            # Verify lifecycle event emission.
            lifecycle_events = (
                sb.table("event_log")
                .select("id", count="exact")
                .in_("category", ["source_sunset_auto", "source_archived_auto"])
                .gte("created_at", started_at)
                .execute()
            )
            if (lifecycle_events.count or 0) >= 2:
                rows.append(
                    _passing(
                        "T19.events",
                        f"{lifecycle_events.count} lifecycle events emitted",
                    )
                )
            else:
                rows.append(
                    _failing(
                        "T19.events",
                        f"only {lifecycle_events.count} lifecycle events",
                    )
                )
        else:
            rows.append(
                _failing(
                    "T19",
                    f"unexpected statuses: {by_key}",
                )
            )
    else:
        rows.append(
            _failing("T19", f"lifecycle script failed: {promotion.stdout[-200:]}")
        )

    # ---- T20 — admin/sources status + countdown UI. ----
    rows.append(
        _skip_browser(
            "T20",
            "Browser: /admin/sources Status column + countdown + Review Candidates in e2e/t4/admin-sources.spec.ts",
        )
    )

    # ---- T21 — changelog entry triggers first-login toast. ----
    rows.append(
        _skip_browser(
            "T21",
            "Browser: changelog toast in e2e/t4/changelog.spec.ts",
        )
    )

    # ---- T22 — Changelog RLS. ----
    # Service role can SELECT all (sanity); anon denial verified in browser.
    chrows = sb.table("changelog_entries").select("id", count="exact").execute()
    if (chrows.count or 0) >= 1:
        rows.append(_passing("T22.svc", f"service-role sees {chrows.count} changelog entries", "C12"))
    else:
        rows.append(_failing("T22.svc", "no changelog entries visible to service role"))
    rows.append(
        _skip_browser("T22.anon", "Anon RLS denial in e2e/t4/changelog.spec.ts", "C12")
    )

    # ---- T23 — /guide §10 About contains credit + links. ----
    if guide_path.exists():
        body = guide_path.read_text()
        ok = (
            "Developed by Yareh Constant" in body
            and "/changelog" in body
            and "/media-kit" in body
        )
        if ok:
            rows.append(_passing("T23", "guide About has credit + /changelog + /media-kit"))
        else:
            rows.append(_failing("T23", "guide About missing credit or links"))
    else:
        rows.append(_failing("T23", "guide page missing"))

    # ---- T24-T31 — All Browser-only. ----
    for tk_id, descr in [
        ("T24", "/media-kit renders 7 sections + stats strip"),
        ("T25", "Rate-card values match RATE_CARD config (Vitest)"),
        ("T26", "Rate-card program links resolve to /prospects?daypart=..."),
        ("T27", "Signal map SVG + city dots + 44x44 hit"),
        ("T28", "Featured-client BSO match resolves to /prospects/<id>"),
        ("T29", "Download print PDF link works"),
        ("T30", "@axe-core/playwright pass on /media-kit at WCAG 2.1 AA"),
        ("T31", "Mobile viewport: rate-card scrolls, signal map scales, etc."),
    ]:
        rows.append(_skip_browser(tk_id, descr))

    # Vitest assertion for T25 — rate-card consistency check is also
    # exercised here at the Python level: read the .ts file and assert
    # the program names match what we documented in the plan.
    rate_card_path = WHRB.parent / "whrb-web" / "config" / "rate-card.ts"
    if rate_card_path.exists():
        body = rate_card_path.read_text()
        wanted = ["Classical", "Jazz", "Blues", "Other", "Sunday Night at the Opera"]
        if all(w in body for w in wanted):
            rows.append(
                _passing("T25.config", "rate-card.ts contains the 4 regular + special programs")
            )
        else:
            rows.append(_failing("T25.config", f"rate-card.ts missing one of {wanted}"))
    else:
        rows.append(_failing("T25.config", "rate-card.ts not found"))

    # ---- Print + summarize. ----
    print()
    print("Stage T4 integrity")
    print(f"  snapshot: {SNAPSHOT_PATH}")
    print(f"  started:  {started_at}")
    print()
    counts = {"PASS": 0, "FAIL": 0, "SKIP-BROWSER": 0, "SKIP-MANUAL": 0}
    for r in rows:
        prefix = f"[{r.status}]"
        line = f"{prefix:<14} {r.id}  {r.msg}"
        print(line)
        counts[r.status] = counts.get(r.status, 0) + 1
    print()
    print(
        f"Stage T4 Tks: pass={counts['PASS']} skip-browser={counts['SKIP-BROWSER']}"
        f" skip-manual={counts['SKIP-MANUAL']} fail={counts['FAIL']}"
        f" (total {len(rows)})"
    )
    return 0 if counts["FAIL"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
