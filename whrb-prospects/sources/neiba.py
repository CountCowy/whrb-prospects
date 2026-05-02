"""Stage T7 — NEIBA Massachusetts bookstores.

Plan §9.4 — trade association. Tags: ``sector:retail``. New England
Independent Booksellers Association MA chapter directory.
"""
from __future__ import annotations

from bs4 import BeautifulSoup

from sources import _t7_common as common

SOURCE_KEY = "neiba"

# Verified live 2026-05-01. The original ``/find-a-bookstore?state=MA``
# (a guess) returns 404. NEIBA exposes per-state landing pages at the
# bare-state URL: ``/ma`` is the Massachusetts members listing. The
# ``?MapView=true`` query param renders the embedded Google-Map view
# alongside the same member list, which is identical content but easier
# to extract from since each marker is rendered with name + address.
LIVE_URL = "https://www.newenglandbooks.org/ma?MapView=true"


def _emit_from_html(html: str) -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")
    rows: list[dict] = []
    for store in soup.select("article.bookstore, .store-card, .member-card"):
        name_el = store.select_one(".store-name") or store.select_one("h3")
        if not name_el:
            continue
        name = name_el.get_text(strip=True)
        if not common.acceptable_name(name):
            continue
        zip_el = store.select_one(".zip") or store.select_one(".store-zip")
        zip_code = zip_el.get_text(strip=True)[:5] if zip_el else None
        if zip_code and not common.in_signal_zone(zip_code):
            continue
        phone_el = store.select_one(".phone") or store.select_one(".store-phone")
        phone = phone_el.get_text(strip=True) if phone_el else None
        link_el = store.select_one("a")
        website = link_el.get("href") if link_el else None

        rows.append(
            common.build_row(
                source_key=SOURCE_KEY,
                company_name=name,
                category="retail/bookstore",
                zip_code=zip_code,
                phone=phone,
                website=website,
                tier="B",
                sector="retail",
                operating_model="retailer",
                cadence="year_round",
                pipeline_notes="neiba: NEIBA MA bookstore",
            )
        )
    if not rows:
        rows = common.emit_via_html_fallback(
            html,
            source_key=SOURCE_KEY,
            category="retail/bookstore",
            tier="B",
            sector="retail",
            operating_model="retailer",
            cadence="year_round",
            pipeline_notes="neiba: NEIBA MA bookstore",
        )
    return common.cap_rows(rows, cap=200)


def run_all() -> list[dict]:
    html = common.read_fixture(SOURCE_KEY, "bookstores", ext="html")
    if html is not None:
        return _emit_from_html(html)
    if common.offline_enabled():
        return []
    rows: list[dict] = []
    try:
        html = common.http_get(LIVE_URL)
        if html:
            rows = _emit_from_html(html)
    except Exception:
        rows = []
    if not rows:
        rendered = common.fetch_html_via_playwright(LIVE_URL)
        if rendered:
            rows = _emit_from_html(rendered)
    return rows
