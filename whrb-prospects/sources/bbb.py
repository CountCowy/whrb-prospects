"""BBB Eastern MA accredited business directory — Playwright (JS-rendered).

Status (Stage 5.5): known flaky — the ``.result-card`` selector drifts with
bbb.org theme updates and Playwright launches fail intermittently on
headless Chromium. Kept behind the ``--with-bbb`` CLI flag intentionally.
Do not re-enable in :data:`config.ENABLED_SOURCES_DEFAULT` until the
selectors are hardened against the current BBB template; see ROLLOUT.md
Stage 1 notes for the original triage.
"""
from __future__ import annotations

from playwright.sync_api import sync_playwright

SEARCH_URL = (
    "https://www.bbb.org/search?find_country=USA"
    "&find_loc=Boston%2C+MA&find_type=Category"
    "&accredited=true&page={page}"
)


def run_all(max_pages: int = 20) -> list[dict]:
    rows: list[dict] = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        for i in range(1, max_pages + 1):
            try:
                page.goto(SEARCH_URL.format(page=i), timeout=30000)
                page.wait_for_selector(".result-card", timeout=10000)
            except Exception as e:
                print(f"[bbb] page {i} failed: {e}")
                break
            cards = page.query_selector_all(".result-card")
            if not cards:
                break
            for c in cards:
                name_el = c.query_selector("h3, .business-name")
                phone_el = c.query_selector(".phone, [href^='tel:']")
                addr_el = c.query_selector(".address")
                site_el = c.query_selector("a[href^='http']:not([href*='bbb.org'])")
                rows.append({
                    "source": "bbb",
                    "tier": "B",
                    "company_name": name_el.inner_text().strip() if name_el else None,
                    "company_phone": phone_el.inner_text().strip() if phone_el else None,
                    "address": addr_el.inner_text().strip() if addr_el else None,
                    "website": site_el.get_attribute("href") if site_el else None,
                    "pipeline_notes": "bbb_accredited",
                })
        browser.close()
    rows = [r for r in rows if r.get("company_name")]
    print(f"[bbb] {len(rows)} rows")
    return rows
