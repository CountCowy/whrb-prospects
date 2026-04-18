"""MA Secretary of State corporate search — officer / agent lookup via Playwright.

Public records; no API. Used selectively to attach owner names to Tier A/B
companies that have no contact name after cheaper enrichment paths have run.

One Chromium instance is launched per `enrich_rows()` call and reused across
lookups — per-row `page.goto()` is cheap compared to `browser.launch()`.
"""
from __future__ import annotations

from playwright.sync_api import Page, sync_playwright

SEARCH_URL = "https://corp.sec.state.ma.us/CorpWeb/CorpSearch/CorpSearch.aspx"

OFFICER_KEYWORDS = ("president", "manager", "treasurer", "secretary", "director")


def _lookup_on_page(page: Page, company_name: str) -> dict | None:
    """Run one search on an already-open page. Returns {'officers': [...]} or None."""
    try:
        page.goto(SEARCH_URL, timeout=20000)
        page.fill("#MainContent_txtEntityName", company_name)
        page.click("#MainContent_btnSearch")
        page.wait_for_load_state("networkidle", timeout=10000)
        link = page.query_selector(
            "#MainContent_SearchControl_grdSearchResultsEntity a"
        )
        if not link:
            return None
        link.click()
        page.wait_for_load_state("networkidle", timeout=10000)
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
            return _lookup_on_page(page, company_name)
        finally:
            browser.close()


def enrich_rows(rows: list[dict], limit: int = 25) -> None:
    """Mutate rows in place, adding contact_name for high-tier missing entries."""
    targeted = [
        r for r in rows
        if r.get("tier") in ("A", "B") and not r.get("contact_name")
    ][:limit]
    if not targeted:
        return
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        page = context.new_page()
        try:
            for row in targeted:
                res = _lookup_on_page(page, row["company_name"])
                if res and res.get("officers"):
                    row["contact_name"] = res["officers"][0]["name"]
                    row["contact_title"] = res["officers"][0]["title"]
                    row.setdefault("pipeline_notes", "")
                    row["pipeline_notes"] += " ma_sos;"
        finally:
            browser.close()
