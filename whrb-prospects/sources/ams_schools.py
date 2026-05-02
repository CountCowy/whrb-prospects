"""Stage T7 — American Montessori Society schools (MA chapter).

Plan §9.4 — trade association. Tags: ``sector:education``.
"""
from __future__ import annotations

from bs4 import BeautifulSoup

from sources import _t7_common as common

SOURCE_KEY = "ams_schools"

# Verified live 2026-05-01. The original ``/Find-a-Montessori-School?state=MA``
# is a 404 (older AMS URL pattern). The current AMS site uses ``/schools/``
# as its school-locator landing page — the search UI is JS-driven, but the
# initial HTML response renders a server-side member list that the parser
# can extract via the generic ZIP-pivot fallback.
LIVE_URL = "https://amshq.org/schools/"


def _emit_from_html(html: str) -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")
    rows: list[dict] = []
    for school in soup.select("article.school, .school-card, .member-card"):
        name_el = school.select_one(".school-name") or school.select_one("h3")
        if not name_el:
            continue
        name = name_el.get_text(strip=True)
        if not common.acceptable_name(name):
            continue
        zip_el = school.select_one(".zip") or school.select_one(".school-zip")
        zip_code = zip_el.get_text(strip=True)[:5] if zip_el else None
        if zip_code and not common.in_signal_zone(zip_code):
            continue
        phone_el = school.select_one(".phone") or school.select_one(".school-phone")
        phone = phone_el.get_text(strip=True) if phone_el else None
        link_el = school.select_one("a")
        website = link_el.get("href") if link_el else None

        rows.append(
            common.build_row(
                source_key=SOURCE_KEY,
                company_name=name,
                category="education/montessori",
                zip_code=zip_code,
                phone=phone,
                website=website,
                tier="A",
                sector="education",
                operating_model="institution",
                cadence=["admissions_window", "term_driven"],
                pipeline_notes="ams_schools: American Montessori Society school",
            )
        )
    if not rows:
        rows = common.emit_via_html_fallback(
            html,
            source_key=SOURCE_KEY,
            category="education/montessori",
            tier="A",
            sector="education",
            operating_model="institution",
            cadence=["admissions_window", "term_driven"],
            pipeline_notes="ams_schools: American Montessori Society school",
        )
    return common.cap_rows(rows, cap=200)


def run_all() -> list[dict]:
    html = common.read_fixture(SOURCE_KEY, "schools", ext="html")
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
