"""Stage T7 — Massachusetts Cultural Council annual grantee list.

Plan §9.4 — regional/grant-list. Tags: ``sector:arts,nonprofit``,
``affiliation`` per locale (ZIP-derived).

The MCC publishes annual grant rolls. The CSV format used here mirrors
their public open-data export (Organization Name, City, ZIP,
Discipline). Live URL fetches the most recent year's compilation.
"""
from __future__ import annotations

from sources import _t7_common as common

SOURCE_KEY = "ma_cultural_council"

LIVE_URL = "https://massculturalcouncil.org/grants/annual-grant-recipients.csv"


def _emit_from_csv(text: str) -> list[dict]:
    rows: list[dict] = []
    for raw in common.parse_csv(text):
        name = (
            raw.get("Organization Name")
            or raw.get("Organization")
            or raw.get("Grantee")
            or raw.get("Name")
            or raw.get("name")
        )
        zip_code = (raw.get("Zip") or raw.get("ZIP") or raw.get("zip") or "")[:5]
        discipline = raw.get("Discipline") or raw.get("Category") or "arts"
        address = raw.get("Address") or raw.get("Street Address")
        phone = raw.get("Phone") or raw.get("phone")
        website = raw.get("Website") or raw.get("URL")

        if not common.acceptable_name(name):
            continue
        if zip_code and not common.in_signal_zone(zip_code):
            continue

        rows.append(
            common.build_row(
                source_key=SOURCE_KEY,
                company_name=name,
                category=f"arts/{discipline.lower().replace(' ', '_')}",
                address=address,
                zip_code=zip_code,
                phone=phone,
                website=website,
                tier="A",
                sector=["arts", "nonprofit"],
                operating_model="institution",
                cadence="year_round",
                pipeline_notes="ma_cultural_council: annual grant recipient",
            )
        )
    return common.cap_rows(rows, cap=1500)


def run_all() -> list[dict]:
    text = common.read_fixture(SOURCE_KEY, "grantees", ext="csv")
    if text is None and not common.offline_enabled():
        try:
            text = common.http_get(LIVE_URL)
        except Exception:
            text = None
    if not text:
        return []
    return _emit_from_csv(text)
