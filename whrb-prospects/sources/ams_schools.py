"""Stage T7 — American Montessori Society schools (MA chapter).

Plan §9.4 — trade association. Tags: ``sector:education``.
"""
from __future__ import annotations

from bs4 import BeautifulSoup

from sources import _t7_common as common

SOURCE_KEY = "ams_schools"

LIVE_URL = "https://amshq.org/Find-a-Montessori-School?state=MA"


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
    return common.cap_rows(rows, cap=200)


def run_all() -> list[dict]:
    html = common.read_fixture(SOURCE_KEY, "schools", ext="html")
    if html is None and not common.offline_enabled():
        try:
            html = common.http_get(LIVE_URL)
        except Exception:
            html = None
    if not html:
        return []
    return _emit_from_html(html)
