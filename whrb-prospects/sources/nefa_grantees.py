"""Stage T7 — New England Foundation for the Arts grantee list.

Plan §9.4 — regional. Tags: ``affiliation:new_england_regional`` +
sector. Rows here often overlap with MCC grantees from MA; T7's manifest
flags ``ma_cultural_council`` as the dedupe partner.
"""
from __future__ import annotations

from sources import _t7_common as common

SOURCE_KEY = "nefa_grantees"

LIVE_URL = "https://www.nefa.org/grants/annual-grantees.csv"


def _emit_from_csv(text: str) -> list[dict]:
    rows: list[dict] = []
    for raw in common.parse_csv(text):
        name = (
            raw.get("Grantee")
            or raw.get("Organization")
            or raw.get("Name")
            or raw.get("name")
        )
        zip_code = (raw.get("Zip") or raw.get("ZIP") or raw.get("zip") or "")[:5]
        state = (raw.get("State") or raw.get("state") or "").strip().upper()
        discipline = raw.get("Discipline") or raw.get("Category") or "arts"

        if not common.acceptable_name(name):
            continue
        # NEFA spans 6 states; rows outside the WHRB ZIP set still surface
        # in the prospect list because they are tagged
        # `affiliation:new_england_regional` (plan §1.3 #19 — fringe ring
        # comes through tags, never ZIP filters).
        in_zone = common.in_signal_zone(zip_code)

        affiliation: list[str] = ["new_england_regional"]
        rows.append(
            common.build_row(
                source_key=SOURCE_KEY,
                company_name=name,
                category=f"arts/{discipline.lower().replace(' ', '_')}",
                zip_code=zip_code,
                tier="B" if in_zone else "C",
                sector=["arts", "nonprofit"],
                operating_model="institution",
                affiliation=affiliation,
                cadence="year_round",
                pipeline_notes=f"nefa_grantees: {state or 'NE'} regional grantee",
                # Don't auto-attach a ZIP-derived affiliation if the row is
                # outside WHRB ZIPs — `affiliation:new_england_regional`
                # is the canonical placement.
                auto_affiliation_from_zip=in_zone,
            )
        )
    return common.cap_rows(rows, cap=600)


def run_all() -> list[dict]:
    text = common.read_fixture(SOURCE_KEY, "grantees", ext="csv")
    if text is None and not common.offline_enabled():
        try:
            text = common.http_get(LIVE_URL)
        except Exception:
            text = None
    if not text:
        return []
    return _emit_from_csv(text)
