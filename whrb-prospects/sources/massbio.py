"""Stage T7 — MassBio member directory.

Plan §9.4 — trade association. Tags: ``sector:technology,medical``.
Massachusetts Biotechnology Council; bridges T7's tech and medical
sectors.
"""
from __future__ import annotations

from bs4 import BeautifulSoup

from sources import _t7_common as common

SOURCE_KEY = "massbio"

LIVE_URL = "https://www.massbio.org/membership/member-directory/"


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
    return common.cap_rows(rows, cap=400)


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
