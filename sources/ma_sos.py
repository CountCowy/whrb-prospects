"""MA Secretary of State corporate search — officer / agent lookup via Playwright.

Public records; no API. Used selectively to attach owner names to Tier A/B
companies that have no contact name after cheaper enrichment paths have run.
"""
from __future__ import annotations

from playwright.sync_api import sync_playwright

SEARCH_URL = "https://corp.sec.state.ma.us/CorpWeb/CorpSearch/CorpSearch.aspx"


def lookup(company_name: str) -> dict | None:
    """Return {'officers': [...], 'agent': str} or None."""
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            page.goto(SEARCH_URL, timeout=30000)
            page.fill("#MainContent_txtEntityName", company_name)
            page.click("#MainContent_btnSearch")
            page.wait_for_load_state("networkidle", timeout=15000)
            link = page.query_selector(
                "#MainContent_SearchControl_grdSearchResultsEntity a"
            )
            if not link:
                return None
            link.click()
            page.wait_for_load_state("networkidle", timeout=15000)
            html = page.content()
            # Parse officer table heuristically — schema is stable but labels vary.
            officers = []
            for row in page.query_selector_all("table tr"):
                cells = [c.inner_text().strip() for c in row.query_selector_all("td")]
                if len(cells) >= 2 and any(
                    w in cells[0].lower()
                    for w in ("president", "manager", "treasurer", "secretary", "director")
                ):
                    officers.append({"title": cells[0], "name": cells[1]})
            return {"officers": officers}
        except Exception as e:
            print(f"[ma_sos] {company_name}: {e}")
            return None
        finally:
            browser.close()


def enrich_rows(rows: list[dict], limit: int = 100) -> None:
    """Mutate rows in place, adding contact_name for high-tier missing entries."""
    targeted = [r for r in rows if r.get("tier") in ("A", "B") and not r.get("contact_name")]
    for row in targeted[:limit]:
        res = lookup(row["company_name"])
        if res and res.get("officers"):
            row["contact_name"] = res["officers"][0]["name"]
            row["contact_title"] = res["officers"][0]["title"]
            row.setdefault("notes", "")
            row["notes"] += " ma_sos;"
