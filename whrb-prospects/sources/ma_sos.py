"""MA Secretary of State corporate search — officer / agent lookup via Playwright.

Public records; no API. Used selectively to attach owner names to Tier A/B
companies that have no contact name after cheaper enrichment paths have run.

One Chromium instance is launched per `enrich_rows()` call and reused across
lookups — per-row `page.goto()` is cheap compared to `browser.launch()`.

Defensive timing: when the SoS WebForms page changes shape (selector drift,
WAF challenge, runner IP block, etc.), every lookup blocks on the default
Playwright timeout. ``enrich_rows`` caps both per-call wall time and total
wall time so a broken site can't eat the entire workflow budget.
"""
from __future__ import annotations

import time

from playwright.sync_api import Page, sync_playwright

from util import event_log

SEARCH_URL = "https://corp.sec.state.ma.us/CorpWeb/CorpSearch/CorpSearch.aspx"

OFFICER_KEYWORDS = ("president", "manager", "treasurer", "secretary", "director")

# Tight per-action timeouts — a healthy lookup completes well under 5 s.
GOTO_TIMEOUT_MS = 15_000
FILL_TIMEOUT_MS = 5_000
NETWORK_IDLE_MS = 8_000

# Bail-out heuristics for ``enrich_rows``.
MAX_CONSECUTIVE_SELECTOR_FAILURES = 3
MAX_TOTAL_WALL_SECONDS = 90.0


class _SelectorMissing(Exception):
    """Raised when the search form's name input never appears."""


def _lookup_on_page(page: Page, company_name: str) -> dict | None:
    """Run one search on an already-open page. Returns ``{'officers': [...]}``
    or ``None``. Raises :class:`_SelectorMissing` when the search input itself
    fails to render so the caller can decide whether to keep trying.
    """
    try:
        page.goto(SEARCH_URL, timeout=GOTO_TIMEOUT_MS)
        page.fill("#MainContent_txtEntityName", company_name, timeout=FILL_TIMEOUT_MS)
    except Exception as e:
        msg = str(e)
        if "MainContent_txtEntityName" in msg or "Timeout" in msg:
            raise _SelectorMissing(msg) from e
        print(f"[ma_sos] {company_name}: {e}")
        return None

    try:
        page.click("#MainContent_btnSearch")
        page.wait_for_load_state("networkidle", timeout=NETWORK_IDLE_MS)
        link = page.query_selector(
            "#MainContent_SearchControl_grdSearchResultsEntity a"
        )
        if not link:
            return None
        link.click()
        page.wait_for_load_state("networkidle", timeout=NETWORK_IDLE_MS)
        officers = []
        for row in page.query_selector_all("table tr"):
            cells = [c.inner_text().strip() for c in row.query_selector_all("td")]
            if len(cells) >= 2 and any(w in cells[0].lower() for w in OFFICER_KEYWORDS):
                officers.append({"title": cells[0], "name": cells[1]})
        return {"officers": officers}
    except Exception as e:
        print(f"[ma_sos] {company_name}: {e}")
        return None


def lookup(company_name: str) -> dict | None:
    """One-shot lookup — launches its own browser. Prefer enrich_rows() for
    bulk use so the browser is reused across queries."""
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            page = browser.new_context().new_page()
            try:
                return _lookup_on_page(page, company_name)
            except _SelectorMissing:
                return None
        finally:
            browser.close()


def enrich_rows(rows: list[dict], limit: int = 25) -> None:
    """Mutate rows in place, adding contact_name for high-tier missing entries.

    Skips remaining lookups once the SoS page proves unresponsive (consecutive
    selector misses) or when the total wall-clock budget is exhausted, so a
    broken upstream site can't starve later pipeline phases.
    """
    targeted = [
        r for r in rows
        if r.get("tier") in ("A", "B") and not r.get("contact_name")
    ][:limit]
    if not targeted:
        return

    selector_failures_seen = 0
    consecutive_selector_failures = 0
    started = time.monotonic()

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        page = context.new_page()
        try:
            for idx, row in enumerate(targeted):
                if time.monotonic() - started > MAX_TOTAL_WALL_SECONDS:
                    event_log.warn(
                        "ma_sos_budget_exhausted",
                        f"ma_sos wall-clock budget exceeded after {idx} rows; skipping {len(targeted) - idx} remaining",
                        context={
                            "processed": idx,
                            "remaining": len(targeted) - idx,
                            "budget_seconds": MAX_TOTAL_WALL_SECONDS,
                        },
                    )
                    break
                try:
                    res = _lookup_on_page(page, row["company_name"])
                except _SelectorMissing as e:
                    selector_failures_seen += 1
                    consecutive_selector_failures += 1
                    if selector_failures_seen == 1:
                        event_log.warn(
                            "ma_sos_selector_missing",
                            "ma_sos search input #MainContent_txtEntityName did not render",
                            context={
                                "company_name": row["company_name"],
                                "url": SEARCH_URL,
                                "detail": str(e)[:200],
                            },
                        )
                    if consecutive_selector_failures >= MAX_CONSECUTIVE_SELECTOR_FAILURES:
                        event_log.warn(
                            "ma_sos_aborted",
                            f"aborting ma_sos after {consecutive_selector_failures} consecutive selector misses",
                            context={
                                "processed": idx + 1,
                                "remaining": len(targeted) - idx - 1,
                            },
                        )
                        break
                    continue
                consecutive_selector_failures = 0
                if res and res.get("officers"):
                    row["contact_name"] = res["officers"][0]["name"]
                    row["contact_title"] = res["officers"][0]["title"]
                    row.setdefault("pipeline_notes", "")
                    row["pipeline_notes"] += " ma_sos;"
        finally:
            browser.close()
