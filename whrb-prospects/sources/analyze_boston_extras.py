"""Stage T7 — Analyze Boston open-data datasets.

Plan §9.4 — 5 Analyze Boston datasets (Licensing Board, Entertainment
Annual, Entertainment One-Time, Food Truck Schedule, Short-Term Rental
Eligibility) plus an APPLICANT-grouping aggregation step over 24-month
permits. Tags vary per license type; the parser maps each fixture to a
(category, tag-set) tuple.

Each fixture is the CSV the corresponding Socrata endpoint returns
(headers preserved). The APPLICANT step aggregates building permits by
applicant name to produce a contractor list — these rows carry
``sector:home_services, operating_model:service_provider``.
"""
from __future__ import annotations

from collections import Counter

from sources import _t7_common as common

SOURCE_KEY = "analyze_boston_extras"

# Live Socrata endpoints (CSV).
_DATASETS: dict[str, dict] = {
    "licensing_board": {
        "url": "https://data.boston.gov/dataset/licensing-board-licenses/resource/96b27e92-c01b-4d22-9bf2-83fe9c7fcb58/download/licensing_board.csv",
        "category": "hospitality/liquor_license",
        "tier": "B",
        "sector": "hospitality",
        "operating_model": "venue",
        "cadence": "year_round",
        "pipeline_notes": "analyze_boston_extras: licensing board",
    },
    "entertainment_annual": {
        "url": "https://data.boston.gov/dataset/entertainment-licenses-annual/resource/entertainment_annual.csv",
        "category": "hospitality/entertainment_annual",
        "tier": "B",
        "sector": "hospitality",
        "operating_model": ["venue", "presenter"],
        "cadence": "year_round",
        "pipeline_notes": "analyze_boston_extras: entertainment annual",
    },
    "entertainment_one_time": {
        "url": "https://data.boston.gov/dataset/entertainment-licenses-one-time/resource/entertainment_one_time.csv",
        "category": "hospitality/entertainment_one_time",
        "tier": "B",
        "sector": "hospitality",
        "operating_model": "presenter",
        "cadence": "seasonal_summer",
        "pipeline_notes": "analyze_boston_extras: entertainment one-time",
    },
    "food_truck_schedule": {
        "url": "https://data.boston.gov/dataset/food-truck-schedule/resource/food_truck_schedule.csv",
        "category": "hospitality/food_truck",
        "tier": "C",
        "sector": "hospitality",
        "operating_model": "retailer",
        "cadence": "seasonal_summer",
        "pipeline_notes": "analyze_boston_extras: food truck",
    },
    "short_term_rental": {
        "url": "https://data.boston.gov/dataset/short-term-rental-eligibility/resource/short_term_rental.csv",
        "category": "hospitality/short_term_rental",
        "tier": "C",
        "sector": "hospitality",
        "operating_model": "retailer",
        "cadence": "year_round",
        "pipeline_notes": "analyze_boston_extras: short-term rental",
    },
    "permits_applicant": {
        # Logical "live" URL — the APPLICANT aggregation is computed
        # client-side from the building-permits dataset.
        "url": "https://data.boston.gov/dataset/approved-building-permits/resource/permits_applicant.csv",
        "category": "home_services/permit_applicant",
        "tier": "C",
        "sector": "home_services",
        "operating_model": "service_provider",
        "cadence": "year_round",
        "pipeline_notes": "analyze_boston_extras: permit applicant aggregation (24mo)",
    },
}


def _emit_from_csv(slug: str, text: str) -> list[dict]:
    spec = _DATASETS.get(slug)
    if spec is None:
        return []
    rows_in = common.parse_csv(text)

    # Special case: APPLICANT aggregation. Roll up permits dataset to
    # one row per APPLICANT name with permit count attached as
    # pipeline_notes.
    if slug == "permits_applicant":
        counts: Counter[str] = Counter()
        zip_by_applicant: dict[str, str] = {}
        for raw in rows_in:
            applicant = raw.get("APPLICANT") or raw.get("applicant") or raw.get("Applicant")
            if not common.acceptable_name(applicant):
                continue
            counts[applicant] += 1
            zip_code = (raw.get("zip") or raw.get("ZIP") or raw.get("Zip") or "")[:5]
            if zip_code and applicant not in zip_by_applicant:
                zip_by_applicant[applicant] = zip_code
        out: list[dict] = []
        for applicant, n in counts.most_common(2000):
            zip_code = zip_by_applicant.get(applicant)
            out.append(
                common.build_row(
                    source_key=SOURCE_KEY,
                    company_name=applicant,
                    category=spec["category"],
                    zip_code=zip_code,
                    tier=spec["tier"],
                    sector=spec["sector"],
                    operating_model=spec["operating_model"],
                    cadence=spec["cadence"],
                    pipeline_notes=f"{spec['pipeline_notes']} (n={n})",
                )
            )
        return common.cap_rows(out, cap=2000)

    # Standard per-row emit.
    rows: list[dict] = []
    for raw in rows_in:
        name = (
            raw.get("BUSINESSNAME")
            or raw.get("DBANAME")
            or raw.get("BUSINESS_NAME")
            or raw.get("BusinessName")
            or raw.get("business_name")
            or raw.get("LICENSEE")
            or raw.get("Licensee")
            or raw.get("Truck Name")
            or raw.get("BUSINESS")
            or raw.get("Property Address")  # STR uses property as identifier
            or raw.get("Name")
            or raw.get("name")
        )
        zip_code = (
            raw.get("ZIP")
            or raw.get("Zip")
            or raw.get("zip")
            or ""
        )[:5]
        address = (
            raw.get("ADDRESS")
            or raw.get("Address")
            or raw.get("STREET_ADDRESS")
            or raw.get("Property Address")
        )
        phone = raw.get("Phone") or raw.get("phone") or raw.get("BUSINESSPHONE")

        if not common.acceptable_name(name):
            continue
        if zip_code and not common.in_signal_zone(zip_code):
            continue

        rows.append(
            common.build_row(
                source_key=SOURCE_KEY,
                company_name=name,
                category=spec["category"],
                address=address,
                zip_code=zip_code,
                phone=phone,
                tier=spec["tier"],
                sector=spec["sector"],
                operating_model=spec["operating_model"],
                cadence=spec["cadence"],
                pipeline_notes=spec["pipeline_notes"],
            )
        )
    return common.cap_rows(rows, cap=1000)


def run_all() -> list[dict]:
    out: list[dict] = []
    for slug, spec in _DATASETS.items():
        text = common.read_fixture(SOURCE_KEY, slug, ext="csv")
        if text is None and not common.offline_enabled():
            try:
                text = common.http_get(spec["url"])
            except Exception:
                text = None
        if not text:
            continue
        out.extend(_emit_from_csv(slug, text))
    return out
