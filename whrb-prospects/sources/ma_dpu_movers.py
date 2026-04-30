"""Stage T7 — MA DPU household-goods movers list.

Plan §9.4 — bulk-CSV. Tags: ``sector:home_services``,
``cadence:move_window,seasonal_summer``.
"""
from __future__ import annotations

from sources import _t7_common as common

SOURCE_KEY = "ma_dpu_movers"

LIVE_URL = "https://www.mass.gov/doc/household-goods-movers-list/download"


def _emit_from_csv(text: str) -> list[dict]:
    rows: list[dict] = []
    for raw in common.parse_csv(text):
        name = (
            raw.get("Company Name")
            or raw.get("Carrier Name")
            or raw.get("Name")
            or raw.get("name")
        )
        zip_code = (raw.get("Zip") or raw.get("ZIP") or raw.get("zip") or "")[:5]
        phone = raw.get("Phone") or raw.get("Phone Number") or raw.get("phone")
        address = raw.get("Address") or raw.get("Street Address")
        website = raw.get("Website") or raw.get("URL")

        if not common.acceptable_name(name):
            continue
        if zip_code and not common.in_signal_zone(zip_code):
            continue

        rows.append(
            common.build_row(
                source_key=SOURCE_KEY,
                company_name=name,
                category="home_services/movers",
                address=address,
                zip_code=zip_code,
                phone=phone,
                website=website,
                tier="C",
                sector="home_services",
                operating_model="service_provider",
                cadence=["move_window", "seasonal_summer"],
                pipeline_notes="ma_dpu_movers: household-goods mover",
            )
        )
    return common.cap_rows(rows, cap=400)


def run_all() -> list[dict]:
    text = common.read_fixture(SOURCE_KEY, "movers", ext="csv")
    if text is None and not common.offline_enabled():
        try:
            text = common.http_get(LIVE_URL)
        except Exception:
            text = None
    if not text:
        return []
    return _emit_from_csv(text)
