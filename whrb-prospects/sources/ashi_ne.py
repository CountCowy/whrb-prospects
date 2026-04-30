"""Stage T7 — ASHI New England home inspectors.

Plan §9.4 — trade association. Tags: ``sector:real_estate,
operating_model:service_provider``.
"""
from __future__ import annotations

from bs4 import BeautifulSoup

from sources import _t7_common as common

SOURCE_KEY = "ashi_ne"

LIVE_URL = "https://www.ashine.org/find-an-inspector"


def _emit_from_html(html: str) -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")
    rows: list[dict] = []
    for member in soup.select("article.inspector, .inspector-card, .member-card"):
        name_el = member.select_one(".member-name") or member.select_one("h3")
        if not name_el:
            continue
        name = name_el.get_text(strip=True)
        if not common.acceptable_name(name):
            continue
        zip_el = member.select_one(".zip") or member.select_one(".member-zip")
        zip_code = zip_el.get_text(strip=True)[:5] if zip_el else None
        phone_el = member.select_one(".phone") or member.select_one(".member-phone")
        phone = phone_el.get_text(strip=True) if phone_el else None
        link_el = member.select_one("a")
        website = link_el.get("href") if link_el else None

        rows.append(
            common.build_row(
                source_key=SOURCE_KEY,
                company_name=name,
                category="real_estate/home_inspector",
                zip_code=zip_code,
                phone=phone,
                website=website,
                tier="C",
                sector="real_estate",
                operating_model="service_provider",
                cadence="year_round",
                pipeline_notes="ashi_ne: ASHI New England inspector",
            )
        )
    return common.cap_rows(rows, cap=200)


def run_all() -> list[dict]:
    html = common.read_fixture(SOURCE_KEY, "inspectors", ext="html")
    if html is None and not common.offline_enabled():
        try:
            html = common.http_get(LIVE_URL)
        except Exception:
            html = None
    if not html:
        return []
    return _emit_from_html(html)
