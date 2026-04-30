"""Stage T7 — Mass.gov Assisted Living Residence list.

Plan §9.4 — bulk-CSV. Tags: ``sector:medical``,
``operating_model:institution``, ``cadence:year_round``.
"""
from __future__ import annotations

from sources import _t7_common as common

SOURCE_KEY = "ma_alr"

LIVE_URL = "https://www.mass.gov/doc/assisted-living-residences-list/download"


def _emit_from_csv(text: str) -> list[dict]:
    rows: list[dict] = []
    for raw in common.parse_csv(text):
        name = raw.get("Residence Name") or raw.get("Name") or raw.get("name")
        zip_code = (raw.get("Zip") or raw.get("ZIP") or raw.get("zip") or "")[:5]
        address = raw.get("Address") or raw.get("Street Address")
        phone = raw.get("Phone") or raw.get("Phone Number") or raw.get("phone")

        if not common.acceptable_name(name):
            continue
        if zip_code and not common.in_signal_zone(zip_code):
            continue

        rows.append(
            common.build_row(
                source_key=SOURCE_KEY,
                company_name=name,
                category="medical/assisted_living",
                address=address,
                zip_code=zip_code,
                phone=phone,
                tier="A",
                sector="medical",
                operating_model="institution",
                cadence="year_round",
                pipeline_notes="ma_alr: assisted living residence",
            )
        )
    return common.cap_rows(rows, cap=500)


def run_all() -> list[dict]:
    text = common.read_fixture(SOURCE_KEY, "residences", ext="csv")
    if text is None and not common.offline_enabled():
        try:
            text = common.http_get(LIVE_URL)
        except Exception:
            text = None
    if not text:
        return []
    return _emit_from_csv(text)
