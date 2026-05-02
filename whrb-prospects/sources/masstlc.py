"""Stage T7 — MassTLC Member Marketplace.

Plan §9.4 — trade association. Tags: ``sector:technology``.
Massachusetts Technology Leadership Council member directory.
"""
from __future__ import annotations

from bs4 import BeautifulSoup

from sources import _t7_common as common

SOURCE_KEY = "masstlc"

# Verified live 2026-05-01. The org rebranded: ``masstlc.org`` 301-redirects
# to ``mtlc.co``. The original ``/page/MemberMarketplace`` (YourMembership-
# style URL pattern) is 404 on the new site. The current member directory
# lives at ``/directory`` on the new domain. (Member Marketplace exists as
# a separate hosted listing at mtlc.membermarketplaceinc.com but the
# ``/directory`` path is the canonical member listing on the main site.)
LIVE_URL = "https://www.mtlc.co/directory"


def _emit_from_html(html: str) -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")
    rows: list[dict] = []
    for member in soup.select("article.member, .member-card, .company-card"):
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
        link_el = member.select_one("a")
        website = link_el.get("href") if link_el else None

        rows.append(
            common.build_row(
                source_key=SOURCE_KEY,
                company_name=name,
                category="technology/masstlc_member",
                zip_code=zip_code,
                website=website,
                tier="A",
                sector="technology",
                operating_model="institution",
                cadence="year_round",
                pipeline_notes="masstlc: MassTLC member",
            )
        )
    if not rows:
        rows = common.emit_via_html_fallback(
            html,
            source_key=SOURCE_KEY,
            category="technology/masstlc_member",
            tier="A",
            sector="technology",
            operating_model="institution",
            cadence="year_round",
            pipeline_notes="masstlc: MassTLC member",
        )
    return common.cap_rows(rows, cap=400)


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
