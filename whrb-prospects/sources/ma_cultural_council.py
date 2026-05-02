"""Stage T7 — Massachusetts Cultural Council annual grantee list.

Plan §9.4 — HTML scraping (rewrite from CSV-fetch 2026-05-01). Tags:
``sector:arts,nonprofit``, ``affiliation`` per locale (city-derived in
absence of a ZIP column).

Source model: MCC publishes its grantee data across several program
pages. The largest, most directly relevant list for a media-buy
prospect funnel is the Cultural Investment Portfolio (CIP) — general
operating grants to nonprofit cultural organizations across the state.
We pin the CIP funding list as the primary source; secondary programs
(Festivals & Projects, Cultural Districts, Local Cultural Council
sub-grants) are out of scope here because their listings are
fragmented across hundreds of municipal sub-pages. CIP alone gives us
~150 named arts nonprofits.

Schema (verified 2026-05-01):

  https://massculturalcouncil.org/organizations/cultural-investment-portfolio/funding-list/
  Single table on the page, three columns:
    Organization | City/Town | Grant ($)

The CSV fixture path is preserved for backwards-compat with the legacy
test plant; the live path now drives Playwright + scrapes the table.

City-name filtering replaces the legacy ZIP filter because MCC
publishes only the city, not a ZIP. :data:`_WHRB_CITIES` is the
city-name set covering WHRB's signal area (matches by case-insensitive
exact compare).
"""
from __future__ import annotations

from sources import _t7_common as common

SOURCE_KEY = "ma_cultural_council"

_LANDING_URL = (
    "https://massculturalcouncil.org/organizations/cultural-investment-portfolio/funding-list/"
)

# Backwards-compat constant — kept as documentation artefact.
LIVE_URL = _LANDING_URL

# City-name filter (case-insensitive). MCC's table uses Title Case ("Boston",
# "Cambridge"); we normalize to lower for comparison.
_WHRB_CITIES: frozenset[str] = frozenset(
    s.lower() for s in (
        "Boston", "Cambridge", "Brookline", "Somerville",
        "Watertown", "Newton", "Medford", "Malden",
        "Quincy", "Salem", "Lynn", "Allston", "Brighton",
        "Jamaica Plain", "Roxbury", "Dorchester",
        "Back Bay", "South End", "Charlestown",
        "East Boston", "Hyde Park", "Mattapan", "West Roxbury",
        "Belmont", "Arlington", "Winchester", "Waltham", "Woburn",
        "Melrose", "Revere", "Chelsea", "Everett", "Peabody",
    )
)


def _fetch_table_rows() -> list[tuple[str, str, str]] | None:
    """Use Playwright to fetch the CIP funding-list page and return a
    list of ``(organization, city, grant)`` tuples (raw strings,
    untrimmed)."""
    try:
        from playwright.sync_api import sync_playwright
    except Exception:
        return None

    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)
            try:
                ctx = browser.new_context(
                    user_agent=(
                        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                        "AppleWebKit/537.36 (KHTML, like Gecko) "
                        "Chrome/120.0.0.0 Safari/537.36"
                    ),
                )
                page = ctx.new_page()
                page.goto(_LANDING_URL, wait_until="networkidle", timeout=30000)
                page.wait_for_timeout(2000)
                rows = page.evaluate(
                    """
                    () => {
                        const out = [];
                        for (const tbl of document.querySelectorAll('table')) {
                            for (const tr of tbl.querySelectorAll('tr')) {
                                const cells = Array.from(tr.querySelectorAll('td')).map(td => td.innerText.trim());
                                if (cells.length >= 2) out.push(cells);
                            }
                        }
                        return out;
                    }
                    """
                )
                # rows is a list-of-lists; convert to tuples and filter
                # to the (org, city, grant) shape (skip rows that are
                # too short or look like headers).
                triples: list[tuple[str, str, str]] = []
                for r in rows or []:
                    if len(r) < 2:
                        continue
                    org = (r[0] or "").strip()
                    city = (r[1] or "").strip()
                    grant = (r[2] if len(r) > 2 else "").strip()
                    if not org or org.lower() == "organization":
                        continue
                    triples.append((org, city, grant))
                return triples
            finally:
                browser.close()
    except Exception:
        return None


def _emit_from_rows(rows_in: list[tuple[str, str, str]]) -> list[dict]:
    rows: list[dict] = []
    for org, city, grant in rows_in:
        if not common.acceptable_name(org):
            continue
        if city.lower() not in _WHRB_CITIES:
            continue
        notes = "ma_cultural_council: CIP grantee"
        if grant:
            notes += f" ({grant})"
        rows.append(
            common.build_row(
                source_key=SOURCE_KEY,
                company_name=org,
                category="arts/cip_grantee",
                tier="A",
                sector=["arts", "nonprofit"],
                operating_model="institution",
                cadence="year_round",
                pipeline_notes=notes,
            )
        )
    return common.cap_rows(rows, cap=1500)


def _emit_from_csv(text: str) -> list[dict]:
    """Backwards-compat CSV path used by offline fixtures."""
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
    if text is not None:
        return _emit_from_csv(text)

    if common.offline_enabled():
        return []

    rows_in = _fetch_table_rows()
    if not rows_in:
        return []
    return _emit_from_rows(rows_in)
