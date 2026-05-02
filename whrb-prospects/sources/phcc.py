"""Stage T7 — PHCC of Massachusetts.

Plan §9.4 — trade association. Tags: ``sector:home_services``.
Plumbing-Heating-Cooling Contractors of Massachusetts.
"""
from __future__ import annotations

from bs4 import BeautifulSoup

from sources import _t7_common as common

SOURCE_KEY = "phcc"

LIVE_URL = "https://www.phccma.org/members"


def _emit_from_html(html: str) -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")
    rows: list[dict] = []
    for member in soup.select("article.member, .contractor-card, .member-card"):
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
                category="home_services/phcc",
                zip_code=zip_code,
                phone=phone,
                website=website,
                tier="C",
                sector="home_services",
                operating_model="service_provider",
                cadence="year_round",
                pipeline_notes="phcc: PHCC of Mass member",
            )
        )
    if not rows:
        rows = common.emit_via_html_fallback(
            html,
            source_key=SOURCE_KEY,
            category="home_services/phcc",
            tier="C",
            sector="home_services",
            operating_model="service_provider",
            cadence="year_round",
            pipeline_notes="phcc: PHCC of Mass member",
        )
    return common.cap_rows(rows, cap=300)


def run_all() -> list[dict]:
    html = common.read_fixture(SOURCE_KEY, "members", ext="html")
    if html is None and not common.offline_enabled():
        try:
            html = common.http_get(LIVE_URL)
        except Exception:
            html = None
    if not html:
        return []
    return _emit_from_html(html)
