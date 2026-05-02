"""Stage T7 — Meet Boston / GBCVB member directory.

Plan §9.4 — trade association. Tags: ``sector:hospitality``.
Greater Boston Convention & Visitors Bureau member roster.
"""
from __future__ import annotations

from bs4 import BeautifulSoup

from sources import _t7_common as common

SOURCE_KEY = "meet_boston"

LIVE_URL = "https://www.meetboston.com/members"


def _emit_from_html(html: str) -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")
    rows: list[dict] = []
    for member in soup.select("article.member, .member-card, .partner-card"):
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
                category="hospitality/gbcvb_member",
                zip_code=zip_code,
                phone=phone,
                website=website,
                tier="B",
                sector="hospitality",
                operating_model="venue",
                cadence="year_round",
                pipeline_notes="meet_boston: GBCVB member",
            )
        )
    if not rows:
        rows = common.emit_via_html_fallback(
            html,
            source_key=SOURCE_KEY,
            category="hospitality/gbcvb_member",
            tier="B",
            sector="hospitality",
            operating_model="venue",
            cadence="year_round",
            pipeline_notes="meet_boston: GBCVB member",
        )
    return common.cap_rows(rows, cap=500)


def run_all() -> list[dict]:
    html = common.read_fixture(SOURCE_KEY, "members", ext="html")
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
