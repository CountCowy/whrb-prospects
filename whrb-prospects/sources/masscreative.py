"""Stage T7 — MASSCreative member directory (HTML).

Plan §9.4 — regional. Tags: ``sector:arts,nonprofit``. Per the
clarifications, this source emits the ``sector:nonprofit`` tag but does
NOT mutate ``is_nonprofit`` / ``nonprofit_source`` (those remain owned
by the IRS BMF pass — see clarifications round 7).
"""
from __future__ import annotations

from bs4 import BeautifulSoup

from sources import _t7_common as common

SOURCE_KEY = "masscreative"

LIVE_URL = "https://www.masscreative.org/members"


def _emit_from_html(html: str) -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")
    rows: list[dict] = []

    # MASSCreative renders members as <article class="member"> blocks
    # with <h3 class="member-name"> and an optional <a class="member-link">.
    # Stub fixtures use the same shape so the parser exercises the
    # production schema.
    for art in soup.select("article.member, .member-card"):
        name_el = art.select_one(".member-name") or art.select_one("h3")
        if not name_el:
            continue
        name = name_el.get_text(strip=True)
        if not common.acceptable_name(name):
            continue
        link_el = art.select_one("a.member-link") or art.select_one("a")
        website = link_el.get("href") if link_el else None
        zip_el = art.select_one(".member-zip") or art.select_one(".zip")
        zip_code = zip_el.get_text(strip=True)[:5] if zip_el else None

        rows.append(
            common.build_row(
                source_key=SOURCE_KEY,
                company_name=name,
                category="arts/masscreative_member",
                zip_code=zip_code,
                website=website,
                tier="B",
                sector=["arts", "nonprofit"],
                operating_model="institution",
                cadence="year_round",
                pipeline_notes="masscreative: member directory",
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
