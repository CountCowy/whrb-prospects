"""Regression tests for ``sources._t7_common.build_row``.

Earlier T7 batches wrote ``row["phone"]``, which the CSV writer
(``pipeline.CSV_COLUMNS``) and ``db.supabase_sync.SCRAPED_FIELDS``
both silently dropped — every T7 source's phone field was lost on
write. The fix lives in ``_t7_common.build_row``; this test pins the
contract so the regression cannot recur.
"""
from __future__ import annotations

from sources import _t7_common as common


def test_build_row_emits_company_phone_not_phone() -> None:
    """Phone must land on the canonical ``company_phone`` key.

    The CSV writer and Supabase sync ignore any other phone-shaped key.
    """
    row = common.build_row(
        source_key="ma_arborists",
        company_name="WHRB Test Trees",
        phone="617-555-0100",
    )
    assert row.get("company_phone") == "617-555-0100", (
        "build_row must emit phones under 'company_phone' — the legacy "
        "'phone' key is silently dropped by pipeline.CSV_COLUMNS."
    )
    assert "phone" not in row, (
        "build_row must NOT emit a 'phone' key — pipeline.CSV_COLUMNS "
        "expects 'company_phone' and the bare 'phone' would be lost on "
        "CSV write."
    )


def test_build_row_omits_phone_when_none() -> None:
    """No phone given → no phone key at all (preserve thin-row shape)."""
    row = common.build_row(
        source_key="ma_arborists",
        company_name="WHRB Test Trees",
    )
    assert "company_phone" not in row
    assert "phone" not in row


def test_build_row_phone_key_in_csv_columns() -> None:
    """Verifies our chosen key actually exists in the canonical column list.

    Drift detector: if someone renames CSV_COLUMNS' phone column,
    this test fires before silent breakage ships.
    """
    from pipeline import CSV_COLUMNS  # type: ignore[import-not-found]

    row = common.build_row(
        source_key="ma_arborists",
        company_name="WHRB Test Trees",
        phone="617-555-0100",
    )
    phone_keys = {k for k in row if "phone" in k.lower()}
    assert phone_keys == {"company_phone"}, phone_keys
    assert "company_phone" in CSV_COLUMNS, (
        "build_row writes 'company_phone' but CSV_COLUMNS no longer "
        "includes it — update both in lockstep."
    )
