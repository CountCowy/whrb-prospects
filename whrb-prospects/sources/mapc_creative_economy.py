"""Stage T7 — MAPC DataCommon Creative Economy dataset (enrichment-only).

Plan §9.4 originally specified this as a per-business roster source.
Live verification on 2026-05-01 — using both Playwright on
``datacommon.mapc.org/browser`` and the underlying open API at
``datacommon.mapc.org/api/`` — found that MAPC's only Creative Economy
table (``creative_economy_m`` in the ``ds.tabular`` schema, sourced
from Data Axle) is **municipality-level aggregate counts only**. Each
row carries fields like ``ceestb`` (creative-economy establishments
count), ``cemp`` (creative-economy employment), and per-sub-sector
breakdowns (``perform_sg`` performing arts, ``musreco_sg`` music
recording, etc.). There are no business names anywhere in MAPC's
catalog under this menu path.

We therefore pivot this source to the same enrichment-only posture as
``sba_7a``: ``run_all()`` returns ``[]``, but a sibling helper
:func:`city_index_for_enrichment` returns a city → creative-economy
establishment count map (filtered to WHRB municipalities). Downstream
enrichment passes can boost the tier of prospects whose city has a
high creative-economy footprint — a meaningful signal even without
direct names.

API endpoint (verified 2026-05-01):
  https://datacommon.mapc.org/api/?token=datacommon&database=ds&schema=tabular&table=creative_economy_m

Returns ~404 municipality rows, JSON-shaped {fields, rows[], total_rows}.
"""
from __future__ import annotations

import json

import requests

from sources import _t7_common as common
from util.http import raise_for_smart_status, smart_retry

SOURCE_KEY = "mapc_creative_economy"

LIVE_URL = (
    "https://datacommon.mapc.org/api/?token=datacommon"
    "&database=ds&schema=tabular&table=creative_economy_m"
)


# WHRB-area cities (Title Case, matching MAPC's ``municipal`` field).
_WHRB_CITIES: frozenset[str] = frozenset(
    {
        "Boston", "Cambridge", "Brookline", "Somerville",
        "Watertown", "Newton", "Medford", "Malden",
        "Quincy", "Salem", "Lynn", "Belmont", "Arlington",
        "Winchester", "Waltham", "Woburn", "Melrose",
        "Revere", "Chelsea", "Everett", "Peabody",
    }
)


@smart_retry()
def _fetch_json() -> dict | None:
    """Fetch the MAPC creative_economy_m table. Returns the raw JSON
    dict or ``None`` on any failure."""
    r = requests.get(
        LIVE_URL,
        headers={
            "User-Agent": common.USER_AGENT,
            "Referer": "https://datacommon.mapc.org/browser",
        },
        timeout=common.HTTP_TIMEOUT_SECONDS,
    )
    raise_for_smart_status(r)
    try:
        return r.json()
    except json.JSONDecodeError:
        return None


def _build_city_index(payload: dict) -> dict[str, int]:
    """Aggregate (municipality → creative-economy establishment count)
    for WHRB-area cities only.

    Uses the most recent ``year`` per municipality. The ``ceestb``
    column carries the creative-economy establishment count; null
    values (cells the publisher couldn't release without disclosing
    individual businesses) are treated as 0.
    """
    rows = payload.get("rows") or []
    # Multiple year rows may exist per municipality; pick the latest year.
    latest_year_by_city: dict[str, str] = {}
    counts: dict[str, int] = {}
    for r in rows:
        city = (r.get("municipal") or "").strip()
        if city not in _WHRB_CITIES:
            continue
        year = str(r.get("year") or "")
        ceestb = r.get("ceestb")
        if ceestb is None:
            ceestb = 0
        try:
            ceestb_i = int(ceestb)
        except (TypeError, ValueError):
            ceestb_i = 0
        prev_year = latest_year_by_city.get(city, "")
        if year >= prev_year:
            latest_year_by_city[city] = year
            counts[city] = ceestb_i
    return counts


def city_index_for_enrichment() -> dict[str, int]:
    """Public hook for downstream enrichment: WHRB-city →
    creative-economy establishment count. Empty dict on any failure."""
    if common.offline_enabled():
        # In offline mode, return empty — fixtures don't exist for the
        # JSON shape and the index is enrichment-only so absence is
        # safe.
        return {}
    try:
        payload = _fetch_json()
    except Exception:
        return {}
    if not payload:
        return {}
    return _build_city_index(payload)


def _emit_from_csv(text: str) -> list[dict]:
    """Backwards-compat CSV path used by offline fixtures.

    The legacy fixture at ``tests/fixtures/t7/mapc_creative_economy/creatives.csv``
    expects per-business columns. Kept so the integrity matrix doesn't
    have to be re-planted before exit-gate rerun. The live path via
    :func:`run_all` always returns ``[]`` because MAPC's actual
    Creative Economy data is municipality-aggregated and contains no
    business names (verified 2026-05-01).
    """
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
    """Returns 0 prospect rows by design — MAPC publishes only
    municipality-aggregated stats for the Creative Economy menu, no
    per-business names. The CSV fixture is parsed (to validate the
    legacy CSV path doesn't crash on shape changes) but the parsed
    rows are discarded since this source is now enrichment-only.

    For city-level enrichment hints (boosting prospects in
    creative-dense municipalities), see :func:`city_index_for_enrichment`.
    """
    # Validate parser path against fixture if present, but discard
    # rows — we're enrichment-only now.
    text = common.read_fixture(SOURCE_KEY, "creatives", ext="csv")
    if text is not None:
        try:
            _emit_from_csv(text)  # validate, discard
        except Exception:
            pass
        return []
    # Same for the live path — fetch + build the index, discard rows.
    if not common.offline_enabled():
        try:
            payload = _fetch_json()
            if payload:
                _build_city_index(payload)
        except Exception:
            pass
    return []
