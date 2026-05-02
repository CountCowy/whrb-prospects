"""Stage T7 — MassBio member directory.

Plan §9.4 — trade association. Tags: ``sector:technology,medical``.
Massachusetts Biotechnology Council; bridges T7's tech and medical
sectors.
"""
from __future__ import annotations

from bs4 import BeautifulSoup

from sources import _t7_common as common

SOURCE_KEY = "massbio"

# Verified live 2026-05-01. The original ``/membership/member-directory/``
# (a guess) is 404. MassBio's current site exposes its member list at
# ``/members/`` (root path on the marketing site).
LIVE_URL = "https://www.massbio.org/members/"


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
                category="technology/biotech",
                zip_code=zip_code,
                website=website,
                tier="A",
                sector=["technology", "medical"],
                operating_model="institution",
                cadence="year_round",
                pipeline_notes="massbio: MassBio member",
            )
        )
    if not rows:
        rows = common.emit_via_html_fallback(
            html,
            source_key=SOURCE_KEY,
            category="technology/biotech",
            tier="A",
            sector=["technology", "medical"],
            operating_model="institution",
            cadence="year_round",
            pipeline_notes="massbio: MassBio member",
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
