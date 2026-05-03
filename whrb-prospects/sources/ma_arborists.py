"""Stage T7 — Massachusetts Arborists Association.

Plan §9.4 — trade association. Tags: ``sector:home_services,
cadence:seasonal_spring,seasonal_fall``.
"""
from __future__ import annotations

from bs4 import BeautifulSoup

from sources import _t7_common as common
from sources._base import ProspectRow

SOURCE_KEY = "ma_arborists"

# Verified live 2026-05-01: ``/find-an-arborist`` (original guess) is
# 404. The real public member directory lives at ``/directory``; an
# alternate consumer-facing path ``/page-18117`` ("Find a Tree Care
# Company") is the same WildApricot index under a different navigation
# label.
LIVE_URL = "https://www.massarbor.org/directory"


def _emit_from_html(html: str) -> list[ProspectRow]:
    soup = BeautifulSoup(html, "html.parser")
    rows: list[ProspectRow] = []
    for member in soup.select("article.member, .arborist-card, .member-card"):
        name_el = member.select_one(".member-name") or member.select_one("h3")
        if not name_el:
            continue
        name = name_el.get_text(strip=True)
        if not common.acceptable_name(name):
            continue
        zip_el = member.select_one(".zip") or member.select_one(".member-zip")
        zip_code = zip_el.get_text(strip=True)[:5] if zip_el else None
        if zip_code and not common.in_signal_zone(zip_code):
            continue
        phone_el = member.select_one(".phone") or member.select_one(".member-phone")
        phone = phone_el.get_text(strip=True) if phone_el else None
        link_el = member.select_one("a")
        website = link_el.get("href") if link_el else None

        rows.append(
            common.build_row(
                source_key=SOURCE_KEY,
                company_name=name,
                category="home_services/arborist",
                zip_code=zip_code,
                phone=phone,
                website=website,
                tier="C",
                sector="home_services",
                operating_model="service_provider",
                cadence=["seasonal_spring", "seasonal_fall"],
                pipeline_notes="ma_arborists: MAA member",
            )
        )
    if not rows:
        rows = common.emit_via_html_fallback(
            html,
            source_key=SOURCE_KEY,
            category="home_services/arborist",
            tier="C",
            sector="home_services",
            operating_model="service_provider",
            cadence=["seasonal_spring", "seasonal_fall"],
            pipeline_notes="ma_arborists: MAA member",
        )
    return common.cap_rows(rows, cap=300)


def run_all() -> list[ProspectRow]:
    html = common.read_fixture(SOURCE_KEY, "members", ext="html")
    if html is not None:
        return _emit_from_html(html)
    if common.offline_enabled():
        return []
    rows: list[ProspectRow] = []
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
