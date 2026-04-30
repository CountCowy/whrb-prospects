"""Stage T7 — Cambridge permits + STR open-data.

Plan §9.4 — 4 Cambridge permit datasets (Building, Plumbing, Electric,
Mechanical) + Short-Term Rentals. Contractor-name rows roll up to
``sector:home_services, operating_model:service_provider``; STR rows go
``sector:hospitality, operating_model:retailer``.
"""
from __future__ import annotations

from collections import Counter

from sources import _t7_common as common

SOURCE_KEY = "cambridge_permits"

_DATASETS: dict[str, dict] = {
    "building": {
        "url": "https://data.cambridgema.gov/api/views/sdt9-4894/rows.csv?accessType=DOWNLOAD",
        "category": "home_services/building_permit",
        "sector": "home_services",
        "operating_model": "service_provider",
        "cadence": "year_round",
        "pipeline_notes": "cambridge_permits: building",
    },
    "plumbing": {
        "url": "https://data.cambridgema.gov/api/views/u8w4-i6vp/rows.csv?accessType=DOWNLOAD",
        "category": "home_services/plumbing_permit",
        "sector": "home_services",
        "operating_model": "service_provider",
        "cadence": "year_round",
        "pipeline_notes": "cambridge_permits: plumbing",
    },
    "electric": {
        "url": "https://data.cambridgema.gov/api/views/zbav-rffa/rows.csv?accessType=DOWNLOAD",
        "category": "home_services/electric_permit",
        "sector": "home_services",
        "operating_model": "service_provider",
        "cadence": "year_round",
        "pipeline_notes": "cambridge_permits: electric",
    },
    "mechanical": {
        "url": "https://data.cambridgema.gov/api/views/cuhp-y84j/rows.csv?accessType=DOWNLOAD",
        "category": "home_services/mechanical_permit",
        "sector": "home_services",
        "operating_model": "service_provider",
        "cadence": "year_round",
        "pipeline_notes": "cambridge_permits: mechanical",
    },
    "short_term_rental": {
        "url": "https://data.cambridgema.gov/api/views/short-term-rental/rows.csv?accessType=DOWNLOAD",
        "category": "hospitality/short_term_rental",
        "sector": "hospitality",
        "operating_model": "retailer",
        "cadence": "year_round",
        "pipeline_notes": "cambridge_permits: short-term rental",
    },
}


def _emit_from_csv(slug: str, text: str) -> list[dict]:
    spec = _DATASETS.get(slug)
    if spec is None:
        return []
    rows_in = common.parse_csv(text)

    # Permit datasets: aggregate by contractor.
    if slug in ("building", "plumbing", "electric", "mechanical"):
        counts: Counter[str] = Counter()
        zip_by_contractor: dict[str, str] = {}
        for raw in rows_in:
            contractor = (
                raw.get("Contractor Name")
                or raw.get("ContractorName")
                or raw.get("contractor_name")
                or raw.get("Applicant")
                or raw.get("applicant")
            )
            if not common.acceptable_name(contractor):
                continue
            counts[contractor] += 1
            zip_code = (
                raw.get("Site Zip")
                or raw.get("Zip")
                or raw.get("zip")
                or ""
            )[:5]
            if zip_code and contractor not in zip_by_contractor:
                zip_by_contractor[contractor] = zip_code
        out: list[dict] = []
        for contractor, n in counts.most_common(1500):
            zip_code = zip_by_contractor.get(contractor)
            out.append(
                common.build_row(
                    source_key=SOURCE_KEY,
                    company_name=contractor,
                    category=spec["category"],
                    zip_code=zip_code,
                    tier="C",
                    sector=spec["sector"],
                    operating_model=spec["operating_model"],
                    cadence=spec["cadence"],
                    pipeline_notes=f"{spec['pipeline_notes']} (n={n})",
                )
            )
        return common.cap_rows(out, cap=1500)

    # STR: each row is a unique address-licensed unit.
    rows: list[dict] = []
    for raw in rows_in:
        name = (
            raw.get("Owner Name")
            or raw.get("OwnerName")
            or raw.get("owner_name")
            or raw.get("Property Address")
        )
        zip_code = (
            raw.get("Zip")
            or raw.get("zip")
            or ""
        )[:5]
        address = raw.get("Property Address") or raw.get("Address")

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
                tier="C",
                sector=spec["sector"],
                operating_model=spec["operating_model"],
                cadence=spec["cadence"],
                pipeline_notes=spec["pipeline_notes"],
            )
        )
    return common.cap_rows(rows, cap=500)


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
