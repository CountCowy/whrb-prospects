"""T7 source manifest — declarative spec for all 22 new sources.

Plan §9.6: T7's integrity matrix is auto-generated from this manifest.
Each entry lists:

  * ``source_key``      — ``source_config`` row + ``SOURCE_KEYS`` slug
  * ``module``          — Python module path under ``sources/``
  * ``fixture_slugs``   — fixture file slugs (extension defaults to .csv,
                          override with ``fixture_ext``)
  * ``fixture_ext``     — ``csv`` | ``html`` | ``json`` (default ``csv``)
  * ``expected_axes``   — minimum (axis, value) pairs every emitted row
                          should carry. Used by the auto-generated C2 test.
  * ``min_rows``        — minimum row count expected from the fixture
  * ``dedupe_partner``  — name of another T7 source whose fixture rows
                          are expected to merge with this one (optional;
                          ``None`` skips the C3 test for this source).
  * ``vocab_migration`` — ``017_t7_vocab.sql`` (admin-approval reference)

The integrity script (``scripts/t7_integrity.py``) walks this manifest
and generates 5 test IDs per source per the plan §9.6 template:

  T7.<source>.C2  — fixture-in / tags-out
  T7.<source>.C9  — source_config row present (+ rows_last_run > 0 if live)
  T7.<source>.C3  — dedupe collision (skipped when ``dedupe_partner`` None)
  T7.<source>.C1  — vocab conformance
  T7.<source>.C8  — zero error log events attributable to this source
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class T7SourceSpec:
    source_key: str
    module: str  # importable as `sources.<module>`
    fixture_slugs: tuple[str, ...]
    expected_axes: tuple[tuple[str, str], ...]
    min_rows: int = 1
    dedupe_partner: str | None = None
    fixture_ext: str = "csv"
    vocab_migration: str = "017_t7_vocab.sql"
    notes: str = ""
    # When the source is enrichment-only (e.g. SBA 7(a)) and produces 0
    # prospect rows, set ``enrichment_only=True`` so C9's "rows_last_run > 0"
    # check is replaced with a SKIP-N/A.
    enrichment_only: bool = False
    # Per-source row caps (applied after parse, before pipeline emit).
    max_rows: int | None = None


T7_SOURCE_MANIFEST: tuple[T7SourceSpec, ...] = (
    # ----- Bulk-CSV: open-data datasets ------------------------------------
    T7SourceSpec(
        source_key="sec_adv",
        module="sec_adv",
        fixture_slugs=("registered",),
        expected_axes=(
            ("sector", "finance"),
            ("operating_model", "service_provider"),
        ),
        min_rows=2,
        dedupe_partner="ma_dpu_movers",  # SEC firm w/ MA office can collide
        notes="SEC Form ADV — registered investment advisers w/ MA principal office.",
    ),
    T7SourceSpec(
        source_key="ma_alr",
        module="ma_alr",
        fixture_slugs=("residences",),
        expected_axes=(
            ("sector", "medical"),
            ("operating_model", "institution"),
            ("cadence", "year_round"),
        ),
        min_rows=2,
        dedupe_partner="mvma_vets",
        notes="Mass.gov Assisted Living Residence list.",
    ),
    T7SourceSpec(
        source_key="ma_dese_nonpublic",
        module="ma_dese_nonpublic",
        fixture_slugs=("schools",),
        expected_axes=(
            ("sector", "education"),
            ("cadence", "term_driven"),
        ),
        min_rows=2,
        dedupe_partner="ams_schools",
        notes="MA DESE Non-Public School dataset.",
    ),
    T7SourceSpec(
        source_key="analyze_boston_extras",
        module="analyze_boston_extras",
        fixture_slugs=(
            "licensing_board",
            "entertainment_annual",
            "entertainment_one_time",
            "food_truck_schedule",
            "short_term_rental",
            "permits_applicant",  # APPLICANT-aggregation step over 24-month permits
        ),
        expected_axes=(
            ("sector", "hospitality"),
        ),
        min_rows=4,
        dedupe_partner="meet_boston",
        notes="5 Analyze Boston datasets + APPLICANT permits aggregation.",
    ),
    T7SourceSpec(
        source_key="cambridge_permits",
        module="cambridge_permits",
        fixture_slugs=(
            "building",
            "plumbing",
            "electric",
            "mechanical",
            "short_term_rental",
        ),
        expected_axes=(
            ("sector", "home_services"),
            ("operating_model", "service_provider"),
        ),
        min_rows=3,
        dedupe_partner="phcc",
        notes="Cambridge open-data permits + STR.",
    ),
    T7SourceSpec(
        source_key="ma_dpu_movers",
        module="ma_dpu_movers",
        fixture_slugs=("movers",),
        expected_axes=(
            ("sector", "home_services"),
            ("cadence", "move_window"),
        ),
        min_rows=2,
        dedupe_partner="phcc",
        notes="MA DPU household-goods movers list.",
    ),
    T7SourceSpec(
        source_key="sba_7a",
        module="sba_7a",
        fixture_slugs=("loans",),
        expected_axes=(),  # enrichment-only; no required emit axis
        min_rows=0,
        dedupe_partner=None,
        enrichment_only=True,
        notes="SBA 7(a)/504 FOIA dataset — enrichment-only (no new rows).",
    ),
    T7SourceSpec(
        source_key="mapc_creative_economy",
        module="mapc_creative_economy",
        fixture_slugs=("creatives",),
        expected_axes=(
            ("sector", "arts"),
        ),
        min_rows=2,
        dedupe_partner="masscreative",
        notes="MAPC DataCommon Creative Economy dataset.",
    ),
    # ----- Regional / grant-list -----------------------------------------
    T7SourceSpec(
        source_key="ma_cultural_council",
        module="ma_cultural_council",
        fixture_slugs=("grantees",),
        expected_axes=(
            ("sector", "arts"),
            ("sector", "nonprofit"),
        ),
        min_rows=3,
        dedupe_partner="masscreative",
        notes="MA Cultural Council annual grantee list.",
    ),
    T7SourceSpec(
        source_key="nefa_grantees",
        module="nefa_grantees",
        fixture_slugs=("grantees",),
        expected_axes=(
            ("affiliation", "new_england_regional"),
        ),
        min_rows=2,
        dedupe_partner="ma_cultural_council",
        notes="New England Foundation for the Arts grantee list.",
    ),
    T7SourceSpec(
        source_key="masscreative",
        module="masscreative",
        fixture_slugs=("members",),
        expected_axes=(
            ("sector", "arts"),
            ("sector", "nonprofit"),
        ),
        min_rows=3,
        dedupe_partner="ma_cultural_council",
        fixture_ext="html",
        notes="MASSCreative member directory.",
    ),
    # ----- Trade associations --------------------------------------------
    T7SourceSpec(
        source_key="mvma_vets",
        module="mvma_vets",
        fixture_slugs=("vets",),
        expected_axes=(
            ("sector", "medical"),
            ("operating_model", "service_provider"),
        ),
        min_rows=2,
        dedupe_partner="ma_alr",
        fixture_ext="html",
        notes="Massachusetts Veterinary Medical Association member directory.",
    ),
    T7SourceSpec(
        source_key="ma_arborists",
        module="ma_arborists",
        fixture_slugs=("members",),
        expected_axes=(
            ("sector", "home_services"),
            ("cadence", "seasonal_spring"),
            ("cadence", "seasonal_fall"),
        ),
        min_rows=2,
        dedupe_partner="ma_landscape_pros",
        fixture_ext="html",
        notes="Massachusetts Arborists Association.",
    ),
    T7SourceSpec(
        source_key="ma_landscape_pros",
        module="ma_landscape_pros",
        fixture_slugs=("members",),
        expected_axes=(
            ("sector", "home_services"),
            ("cadence", "seasonal_spring"),
        ),
        min_rows=2,
        dedupe_partner="ma_arborists",
        fixture_ext="html",
        notes="MA Association of Landscape Professionals.",
    ),
    T7SourceSpec(
        source_key="phcc",
        module="phcc",
        fixture_slugs=("members",),
        expected_axes=(
            ("sector", "home_services"),
        ),
        min_rows=2,
        dedupe_partner="cambridge_permits",
        fixture_ext="html",
        notes="PHCC of Massachusetts (plumbing/heating/cooling contractors).",
    ),
    T7SourceSpec(
        source_key="ashi_ne",
        module="ashi_ne",
        fixture_slugs=("inspectors",),
        expected_axes=(
            ("sector", "real_estate"),
            ("operating_model", "service_provider"),
        ),
        min_rows=2,
        dedupe_partner="phcc",
        fixture_ext="html",
        notes="ASHI New England home inspectors.",
    ),
    T7SourceSpec(
        source_key="neiba",
        module="neiba",
        fixture_slugs=("bookstores",),
        expected_axes=(
            ("sector", "retail"),
        ),
        min_rows=2,
        dedupe_partner=None,
        fixture_ext="html",
        notes="NEIBA MA bookstores.",
    ),
    T7SourceSpec(
        source_key="ams_schools",
        module="ams_schools",
        fixture_slugs=("schools",),
        expected_axes=(
            ("sector", "education"),
        ),
        min_rows=2,
        dedupe_partner="ma_dese_nonpublic",
        fixture_ext="html",
        notes="American Montessori Society schools.",
    ),
    T7SourceSpec(
        source_key="massbio",
        module="massbio",
        fixture_slugs=("members",),
        expected_axes=(
            ("sector", "technology"),
        ),
        min_rows=2,
        dedupe_partner="masstlc",
        fixture_ext="html",
        notes="MassBio member directory.",
    ),
    T7SourceSpec(
        source_key="masstlc",
        module="masstlc",
        fixture_slugs=("members",),
        expected_axes=(
            ("sector", "technology"),
        ),
        min_rows=2,
        dedupe_partner="massbio",
        fixture_ext="html",
        notes="MassTLC Member Marketplace.",
    ),
    T7SourceSpec(
        source_key="meet_boston",
        module="meet_boston",
        fixture_slugs=("members",),
        expected_axes=(
            ("sector", "hospitality"),
        ),
        min_rows=2,
        dedupe_partner="analyze_boston_extras",
        fixture_ext="html",
        notes="Meet Boston / GBCVB member directory.",
    ),
    # ----- Mass Save HPIN -------------------------------------------------
    T7SourceSpec(
        source_key="mass_save_hpin",
        module="mass_save_hpin",
        fixture_slugs=("contractors",),
        expected_axes=(
            ("sector", "home_services"),
            ("history", "hpin_certified"),
        ),
        min_rows=2,
        dedupe_partner="ma_landscape_pros",
        fixture_ext="html",
        notes="Mass Save Home Performance Installer Network — HPIN certified.",
    ),
)


def by_key(key: str) -> T7SourceSpec | None:
    for spec in T7_SOURCE_MANIFEST:
        if spec.source_key == key:
            return spec
    return None


def all_keys() -> tuple[str, ...]:
    return tuple(s.source_key for s in T7_SOURCE_MANIFEST)


def dedupe_partner_pairs() -> list[tuple[str, str]]:
    """Return a list of (source, partner) pairs covering every distinct
    dedupe relationship in the manifest. Useful for the t7_plant script
    to know which collision rows to seed.
    """
    pairs: list[tuple[str, str]] = []
    seen: set[frozenset[str]] = set()
    for spec in T7_SOURCE_MANIFEST:
        if spec.dedupe_partner is None:
            continue
        key = frozenset({spec.source_key, spec.dedupe_partner})
        if key in seen:
            continue
        seen.add(key)
        pairs.append((spec.source_key, spec.dedupe_partner))
    return pairs
