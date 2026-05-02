"""Stage T7 — Cambridge permits + STR open-data.

Plan §9.4 — 4 Cambridge permit datasets (Building, Plumbing, Electric,
Mechanical) + Short-Term Rentals. Contractor-name rows roll up to
``sector:home_services, operating_model:service_provider``; STR rows go
``sector:hospitality, operating_model:retailer``.

URLs verified live against Cambridge open data
(``data.cambridgema.gov``) on 2026-05-01: every Socrata view returns 200
+ ``text/csv`` with the contractor / owner columns the parser expects.
The original IDs (``sdt9-4894`` etc.) were placeholders that 404 — replaced
below with the real Socrata 4×4 IDs discovered through the Socrata
``/api/views.json`` listing endpoint.

Building permits split: Cambridge publishes two building datasets —
Addition/Alteration (``qu2z-8suj``, ~12 MB, the bulk of contractor
records) and New Construction (``9qm7-wbdc``, ~331 KB). We pin the
Addition/Alteration set under ``"building"`` since it dominates the row
volume; New Construction is a much smaller side feed and is left out to
keep the manifest's 5-slug fixture surface stable.

Schema notes (verified 2026-05-02 by inspecting actual CSV headers):

  * Each dataset uses a DIFFERENT column header for the contractor /
    applicant name (a common Socrata-publisher quirk):

      - building (qu2z-8suj):   ``applicant_name``  (snake_case)
      - plumbing (8793-tet2):   ``Company Name``    (Title Case)
      - electric (hvtc-3ab9):   ``Licensee``        (proper noun)
      - mechanical (4rb4-q8tj): ``Applicant name`` / ``Company Name``
      - STR (wxgv-w968):        no owner-name column at all — falls
                                back to ``full address``

  * NO dataset publishes a standalone ZIP column. ZIPs are embedded in
    the freeform address column (``Address`` for building/plumbing,
    ``Full Address`` for electric, ``full address`` lowercase for
    mechanical/STR), e.g. ``"9 Story St, Cambridge, MA 02138"``. The
    parser extracts the trailing ZIP via regex.
"""
from __future__ import annotations

import re
from collections import Counter

from sources import _t7_common as common

# Trailing-ZIP regex: pulls the 5-digit ZIP off the end of a free-form
# address like "9 Story St, Cambridge, MA 02138" or
# "245 Mass Ave Cambridge MA 02139-1234".
_ZIP_IN_ADDRESS_RE = re.compile(r"\b(0[12]\d{3})(?:-\d{4})?\b")

SOURCE_KEY = "cambridge_permits"

_DATASETS: dict[str, dict] = {
    "building": {
        # Building Permits: Addition/Alteration (qu2z-8suj). Bigger of
        # the two Cambridge building datasets; carries the bulk of the
        # contractor name signal. New Construction (9qm7-wbdc) is the
        # other half but is intentionally not pinned here to keep the
        # manifest fixture surface at 5 slugs.
        "url": "https://data.cambridgema.gov/api/views/qu2z-8suj/rows.csv?accessType=DOWNLOAD",
        "category": "home_services/building_permit",
        "sector": "home_services",
        "operating_model": "service_provider",
        "cadence": "year_round",
        "pipeline_notes": "cambridge_permits: building (addition/alteration)",
    },
    "plumbing": {
        "url": "https://data.cambridgema.gov/api/views/8793-tet2/rows.csv?accessType=DOWNLOAD",
        "category": "home_services/plumbing_permit",
        "sector": "home_services",
        "operating_model": "service_provider",
        "cadence": "year_round",
        "pipeline_notes": "cambridge_permits: plumbing",
    },
    "electric": {
        "url": "https://data.cambridgema.gov/api/views/hvtc-3ab9/rows.csv?accessType=DOWNLOAD",
        "category": "home_services/electric_permit",
        "sector": "home_services",
        "operating_model": "service_provider",
        "cadence": "year_round",
        "pipeline_notes": "cambridge_permits: electric",
    },
    "mechanical": {
        "url": "https://data.cambridgema.gov/api/views/4rb4-q8tj/rows.csv?accessType=DOWNLOAD",
        "category": "home_services/mechanical_permit",
        "sector": "home_services",
        "operating_model": "service_provider",
        "cadence": "year_round",
        "pipeline_notes": "cambridge_permits: mechanical",
    },
    "short_term_rental": {
        # Cambridge Short Term Rentals dataset (wxgv-w968). Schema is
        # owner-occupant level (one row per registered STR) with columns
        # like "ID", "Issue Date", "Status", lat/long, and a free-form
        # "address" column. Owner Name is not exposed; the parser uses
        # "Property Address" as the company_name fallback (see
        # _emit_from_csv).
        "url": "https://data.cambridgema.gov/api/views/wxgv-w968/rows.csv?accessType=DOWNLOAD",
        "category": "hospitality/short_term_rental",
        "sector": "hospitality",
        "operating_model": "retailer",
        "cadence": "year_round",
        "pipeline_notes": "cambridge_permits: short-term rental",
    },
}


# Per-dataset contractor-name column priority. Each Cambridge Socrata
# CSV uses different headers for the same conceptual column; this map
# encodes the priority list per slug. The first non-empty match wins.
_NAME_KEYS_BY_SLUG: dict[str, tuple[str, ...]] = {
    "building": (
        "applicant_name",
        "Architecture Firm",
        "Firm Name",
        # Legacy fixture column kept as fallback for the offline C2 test:
        "Contractor Name",
    ),
    "plumbing": (
        "Company Name",
        "Applicant Name",
        "applicant_name",
        "Contractor Name",
    ),
    "electric": (
        "Licensee",
        "Company Name",
        "Applicant Name",
        "applicant_name",
        "Contractor Name",
    ),
    "mechanical": (
        "Company Name",
        "Applicant name",       # note lowercase 'name'
        "Applicant Name",
        "applicant_name",
        "Contractor Name",
    ),
}

# Address column priority. Cambridge varies between Title Case
# ``Address``, ``Full Address``, and lowercase ``full address`` across
# datasets.
_ADDRESS_KEYS: tuple[str, ...] = (
    "Address",
    "Full Address",
    "full address",
    "address",
)


def _pick(raw: dict, keys: tuple[str, ...]) -> str | None:
    for k in keys:
        v = raw.get(k)
        if v is None:
            continue
        s = str(v).strip()
        if s:
            return s
    return None


def _zip_from_address(addr: str | None) -> str | None:
    if not addr:
        return None
    m = _ZIP_IN_ADDRESS_RE.search(addr)
    return m.group(1) if m else None


# Legacy fixture ZIP keys — checked before falling back to address parsing.
_LEGACY_ZIP_KEYS: tuple[str, ...] = (
    "Site Zip", "Zip", "zip", "ZIP", "site_zip",
)


def _resolve_zip(raw: dict, address: str | None) -> str | None:
    """Pick the ZIP from a row's legacy ZIP column if present, otherwise
    extract from the freeform address. Lets the parser cover both the
    legacy fixture shape (``Site Zip`` column) and the live Cambridge
    Socrata shape (no ZIP column; ZIP embedded in address)."""
    legacy = _pick(raw, _LEGACY_ZIP_KEYS)
    if legacy:
        return legacy[:5]
    return _zip_from_address(address)


def _emit_from_csv(slug: str, text: str) -> list[dict]:
    spec = _DATASETS.get(slug)
    if spec is None:
        return []
    rows_in = common.parse_csv(text)

    # Permit datasets: aggregate by contractor / licensee.
    if slug in ("building", "plumbing", "electric", "mechanical"):
        counts: Counter[str] = Counter()
        zip_by_contractor: dict[str, str] = {}
        name_keys = _NAME_KEYS_BY_SLUG[slug]
        for raw in rows_in:
            contractor = _pick(raw, name_keys)
            if not common.acceptable_name(contractor):
                continue
            counts[contractor] += 1
            address = _pick(raw, _ADDRESS_KEYS)
            zip_code = _resolve_zip(raw, address)
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

    # STR: each row is a unique address-licensed unit. The dataset has
    # no owner-name column, so we fall back to the address as the row
    # identifier and let downstream contact-enrichment fill in the
    # owner-of-record field.
    rows: list[dict] = []
    for raw in rows_in:
        address = _pick(raw, _ADDRESS_KEYS) or _pick(raw, ("Property Address", "condominium address"))
        # Owner name first if present (legacy fixtures had it); fall
        # back to the address itself as the company_name.
        name = (
            raw.get("Owner Name")
            or raw.get("OwnerName")
            or raw.get("owner_name")
            or address
        )
        zip_code = _resolve_zip(raw, address)

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
