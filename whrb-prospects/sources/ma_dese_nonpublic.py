"""Stage T7 — MA DESE Non-Public School dataset.

Plan §9.4 — bulk-CSV. Tags: ``sector:education``,
``cadence:admissions_window,term_driven``.
"""
from __future__ import annotations

from sources import _t7_common as common

SOURCE_KEY = "ma_dese_nonpublic"

LIVE_URL = "https://profiles.doe.mass.edu/statereport/nonpublicschools.aspx?export=true"


def _emit_from_csv(text: str) -> list[dict]:
    rows: list[dict] = []
    for raw in common.parse_csv(text):
        name = raw.get("School Name") or raw.get("Name") or raw.get("school_name")
        zip_code = (raw.get("Zip") or raw.get("ZIP") or raw.get("zip") or "")[:5]
        address = raw.get("Address") or raw.get("Street Address")
        phone = raw.get("Phone") or raw.get("phone")
        website = raw.get("Website") or raw.get("URL") or raw.get("website")

        if not common.acceptable_name(name):
            continue
        if zip_code and not common.in_signal_zone(zip_code):
            continue

        rows.append(
            common.build_row(
                source_key=SOURCE_KEY,
                company_name=name,
                category="education/nonpublic_school",
                address=address,
                zip_code=zip_code,
                phone=phone,
                website=website,
                tier="A",
                sector="education",
                operating_model="institution",
                cadence=["admissions_window", "term_driven"],
                pipeline_notes="ma_dese_nonpublic: non-public school",
            )
        )
    return common.cap_rows(rows, cap=600)


def run_all() -> list[dict]:
    text = common.read_fixture(SOURCE_KEY, "schools", ext="csv")
    if text is None and not common.offline_enabled():
        try:
            text = common.http_get(LIVE_URL)
        except Exception:
            text = None
    if not text:
        return []
    return _emit_from_csv(text)
