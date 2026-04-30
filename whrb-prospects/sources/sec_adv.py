"""Stage T7 — SEC Form ADV: registered investment advisers w/ MA principal office.

Plan §9.4 — bulk-CSV source. Tags: ``sector:finance``,
``operating_model:service_provider``, ``affiliation`` from principal
office ZIP.

Live URL is a quarterly compilation; cache TTL bumped to 7 days via
``CACHE_TTL_BULK_CSV_SECONDS``. The source filters rows whose
``Main Office State`` is MA AND whose ``Main Office ZIP`` falls within
``WHRB_ZIPS``.

Fixture-driven (offline) tests live at
``tests/fixtures/t7/sec_adv/registered.csv``.
"""
from __future__ import annotations

from sources import _t7_common as common

SOURCE_KEY = "sec_adv"

# SEC IAPD Form ADV compilation (quarterly). Live URL is documented here so
# the live-fetch path in ``t7_plant.py`` knows where to download from. Live
# fetch is not exercised by ``run_all`` in offline mode.
LIVE_URL = (
    "https://www.sec.gov/help/foiadocsinvafoiahtm/data/iapdfirm.csv"
)


def _emit_from_csv(text: str) -> list[dict]:
    """Parse the SEC ADV CSV; emit one row per MA-principal-office firm."""
    rows: list[dict] = []
    for raw in common.parse_csv(text):
        # Real SEC ADV columns: "Primary Business Name", "Main Office State",
        # "Main Office Postal Code", "Main Office Phone Number". Stub
        # fixtures use the same column names so the parser exercises the
        # production schema.
        name = raw.get("Primary Business Name") or raw.get("primary_business_name")
        state = (raw.get("Main Office State") or raw.get("main_office_state") or "").strip().upper()
        zip_code = (raw.get("Main Office Postal Code") or raw.get("main_office_postal_code") or "")[:5]
        phone = raw.get("Main Office Phone Number") or raw.get("main_office_phone_number")

        if state and state != "MA":
            continue
        if not common.acceptable_name(name):
            continue
        if not common.in_signal_zone(zip_code):
            continue

        rows.append(
            common.build_row(
                source_key=SOURCE_KEY,
                company_name=name,
                category="finance/investment_adviser",
                zip_code=zip_code,
                phone=phone,
                tier="A",
                sector="finance",
                operating_model="service_provider",
                cadence="year_round",
                pipeline_notes="sec_adv: registered investment adviser",
            )
        )
    return common.cap_rows(rows, cap=1500)


def run_all() -> list[dict]:
    text = common.read_fixture(SOURCE_KEY, "registered", ext="csv")
    if text is None and not common.offline_enabled():
        try:
            text = common.http_get(LIVE_URL)
        except Exception:
            text = None
    if not text:
        return []
    return _emit_from_csv(text)
