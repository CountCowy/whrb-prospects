"""Stage T7 — MAPC DataCommon Creative Economy dataset.

Plan §9.4 — bulk-CSV. Tags: ``sector:arts``, ``affiliation`` from
locale (ZIP-derived). Cuts a sub-list of the MAPC creative-economy
report's per-business roster.
"""
from __future__ import annotations

from sources import _t7_common as common

SOURCE_KEY = "mapc_creative_economy"

LIVE_URL = (
    "https://datacommon.mapc.org/datasets/creative-economy/download.csv"
)


def _emit_from_csv(text: str) -> list[dict]:
    rows: list[dict] = []
    for raw in common.parse_csv(text):
        name = (
            raw.get("Business Name")
            or raw.get("Organization")
            or raw.get("Name")
            or raw.get("name")
        )
        zip_code = (raw.get("Zip") or raw.get("ZIP") or raw.get("zip") or "")[:5]
        category = raw.get("Category") or raw.get("NAICS Description") or "arts/creative"
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
                category=f"arts/{category.lower().replace(' ', '_')}",
                address=address,
                zip_code=zip_code,
                phone=phone,
                website=website,
                tier="B",
                sector="arts",
                operating_model="service_provider",
                cadence="year_round",
                pipeline_notes="mapc_creative_economy: creative-economy roster",
            )
        )
    return common.cap_rows(rows, cap=600)


def run_all() -> list[dict]:
    text = common.read_fixture(SOURCE_KEY, "creatives", ext="csv")
    if text is None and not common.offline_enabled():
        try:
            text = common.http_get(LIVE_URL)
        except Exception:
            text = None
    if not text:
        return []
    return _emit_from_csv(text)
