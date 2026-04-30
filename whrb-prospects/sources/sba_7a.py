"""Stage T7 — SBA 7(a) / 504 FOIA dataset (enrichment-only).

Plan §9.4 — enrichment-only tags: ``affiliation`` from ZIP; no new
direct prospects. The intent is to enrich existing rows whose ZIP
matches a recent SBA 7(a) borrower with a hint that the business has
recent debt-financing activity (a positive ad-buy proxy).

In v1 of T7 the source returns an empty prospect list; the lookup
table is built by ``_build_zip_index`` and exposed via
``zip_index_for_enrichment`` for downstream callers.
"""
from __future__ import annotations

from collections import Counter

from sources import _t7_common as common

SOURCE_KEY = "sba_7a"

LIVE_URL = "https://www.sba.gov/sites/default/files/2024-foia/foia-7a-fy2020.csv"


def _build_zip_index(text: str) -> dict[str, int]:
    """Aggregate borrower ZIP → loan count for the lookup table.

    Used only for enrichment-side affiliation hinting; never emitted as
    prospect rows.
    """
    counts: Counter[str] = Counter()
    for raw in common.parse_csv(text):
        zip_code = (
            raw.get("BorrZip")
            or raw.get("Zip")
            or raw.get("zip")
            or ""
        )[:5]
        if not zip_code:
            continue
        if not common.in_signal_zone(zip_code):
            continue
        counts[zip_code] += 1
    return dict(counts)


def _emit_from_csv(text: str) -> list[dict]:
    """Parse the fixture; emits ZERO prospect rows by design.

    The C2 integrity test for an enrichment-only source asserts that
    the parser runs without raising and that the ZIP index it produces
    is a non-empty dict (when fixture has ≥1 in-zone row).
    """
    # Build the index (validates parsing) but discard output rows.
    _build_zip_index(text)
    return []


def zip_index_for_enrichment() -> dict[str, int]:
    """Public hook for downstream enrichment passes."""
    text = common.read_fixture(SOURCE_KEY, "loans", ext="csv")
    if text is None and not common.offline_enabled():
        try:
            text = common.http_get(LIVE_URL)
        except Exception:
            text = None
    if not text:
        return {}
    return _build_zip_index(text)


def run_all() -> list[dict]:
    """Runs the parser end-to-end. By design produces 0 prospect rows."""
    text = common.read_fixture(SOURCE_KEY, "loans", ext="csv")
    if text is None and not common.offline_enabled():
        try:
            text = common.http_get(LIVE_URL)
        except Exception:
            text = None
    if not text:
        return []
    return _emit_from_csv(text)
