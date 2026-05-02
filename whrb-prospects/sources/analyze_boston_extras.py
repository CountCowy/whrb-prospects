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

URLs verified live against Boston CKAN (``data.boston.gov``) on
2026-05-01 via the dataset-show API: every entry below points at a
specific ``resource/<uuid>/download/<file>.csv`` with a 200 + ``text/csv``
response. The Socrata-style filenames (``tmp...csv``) are the actual
filenames CKAN serves; do not rewrite them by hand because they change
when the publisher reuploads.
"""
from __future__ import annotations

from collections import Counter

from sources import _t7_common as common

SOURCE_KEY = "analyze_boston_extras"

# Live Socrata endpoints (CSV).
_DATASETS: dict[str, dict] = {
    "licensing_board": {
        # Boston CKAN: dataset 1b020058… / resource 04dc653b… (CKAN
        # API: package_show name="licensing-board-licenses").
        "url": "https://data.boston.gov/dataset/1b020058-038a-43fd-888b-529e76dec04a/resource/04dc653b-1789-4374-9669-b07df7233344/download/tmpquhdr0ri.csv",
        "category": "hospitality/liquor_license",
        "tier": "B",
        "sector": "hospitality",
        "operating_model": "venue",
        "cadence": "year_round",
        "pipeline_notes": "analyze_boston_extras: licensing board",
    },
    "entertainment_annual": {
        # Boston CKAN slug "entertainment-licenses-legacy" (the public
        # dataset that holds annual entertainment licenses).
        "url": "https://data.boston.gov/dataset/0d93d762-da11-4cea-9bf0-77aaa5d25c36/resource/eb683641-e358-4c2c-95de-c84f32c09147/download/tmpaqgzf1e6.csv",
        "category": "hospitality/entertainment_annual",
        "tier": "B",
        "sector": "hospitality",
        "operating_model": ["venue", "presenter"],
        "cadence": "year_round",
        "pipeline_notes": "analyze_boston_extras: entertainment annual",
    },
    "entertainment_one_time": {
        "url": "https://data.boston.gov/dataset/9076010d-663a-40da-b683-a46ec4d09555/resource/ea7f0605-ffc0-4ad4-a786-02c50b276f54/download/tmpozmzxiku.csv",
        "category": "hospitality/entertainment_one_time",
        "tier": "B",
        "sector": "hospitality",
        "operating_model": "presenter",
        "cadence": "seasonal_summer",
        "pipeline_notes": "analyze_boston_extras: entertainment one-time",
    },
    "food_truck_schedule": {
        "url": "https://data.boston.gov/dataset/dfb17294-33c4-45ce-bff4-976e13b6f79a/resource/f56ce26c-d020-495a-9c6a-3f3ad41b5425/download/food_truck_schedule.csv",
        "category": "hospitality/food_truck",
        "tier": "C",
        "sector": "hospitality",
        "operating_model": "retailer",
        "cadence": "seasonal_summer",
        "pipeline_notes": "analyze_boston_extras: food truck",
    },
    "short_term_rental": {
        "url": "https://data.boston.gov/dataset/b6af4d9e-a693-483f-aed1-ba059302efab/resource/83621b97-9a00-4aa7-bf43-28cae04969d4/download/tmph939z7n3.csv",
        "category": "hospitality/short_term_rental",
        "tier": "C",
        "sector": "hospitality",
        "operating_model": "retailer",
        "cadence": "year_round",
        "pipeline_notes": "analyze_boston_extras: short-term rental",
    },
    "permits_applicant": {
        # Approved building permits master (~159 MB CSV).
        # `_emit_from_csv` aggregates it by APPLICANT to produce a
        # contractor roster keyed on permit count.
        "url": "https://data.boston.gov/dataset/cd1ec3ff-6ebf-4a65-af68-8329eceab740/resource/6ddcd912-32a0-43df-9908-63574f8c7e77/download/tmprbed9rs0.csv",
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
        # Try the business-name fields first; only fall back to Property
        # Address when STR rows have no other identifier. Track that
        # fallback so we don't emit ``name == address`` for the same row.
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
            or raw.get("Name")
            or raw.get("name")
        )
        property_address = raw.get("Property Address")
        name_from_property = False
        if not name and property_address:
            name = property_address
            name_from_property = True
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
        )
        # If we used property_address as the name, don't repeat it as
        # the address — leave address blank and let downstream enrichment
        # populate it.
        if not address and property_address and not name_from_property:
            address = property_address
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
