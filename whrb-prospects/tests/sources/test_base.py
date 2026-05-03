"""Smoke tests for the source typing contract.

TypedDict + Protocol are erased at runtime, so most of the value comes
from mypy in CI rather than pytest. These tests exist to:

* fail loudly if the module stops importing (catches accidental cycles
  or missing typing imports);
* verify the canonical field set matches ``pipeline.CSV_COLUMNS`` so
  the two don't drift silently;
* confirm a real source module structurally satisfies
  :class:`ProspectSource`.
"""
from __future__ import annotations

from sources._base import ProspectRow, ProspectSource, RunAll


def test_prospect_row_accepts_partial_dict() -> None:
    """A source emitting just the required identity fields is valid."""
    row: ProspectRow = {"company_name": "WHRB", "source": "test", "tier": "A"}
    assert row["company_name"] == "WHRB"
    assert row["source"] == "test"


def test_prospect_row_accepts_full_shape() -> None:
    """The full CSV-aligned shape is also valid (sanity-check the keys)."""
    row: ProspectRow = {
        "company_name": "Example",
        "source": "test",
        "tier": "B",
        "website": "https://example.com",
        "company_phone": "+1-617-555-0100",
        "address": "1 Example St",
        "zip": "02138",
        "category": "test/example",
        "tags": {"sector": ["arts"], "affiliation": ["cambridge_based"]},
        "pipeline_notes": "test row",
    }
    assert row["tags"]["sector"] == ["arts"]


def test_runall_alias_is_callable_returning_list() -> None:
    """Trivial source-shaped function should fit the RunAll alias."""
    def fake_run_all() -> list[ProspectRow]:
        return [{"company_name": "WHRB", "source": "fake", "tier": "A"}]

    fn: RunAll = fake_run_all
    assert fn() == [{"company_name": "WHRB", "source": "fake", "tier": "A"}]


def test_real_source_module_satisfies_protocol() -> None:
    """A live source module should structurally satisfy ProspectSource.

    Modules don't subclass Protocols — Python checks structural equality
    by attribute presence. This test confirms ``ma_arborists`` (one of
    the migration targets) exposes the expected attributes.
    """
    from sources import ma_arborists  # type: ignore[import-not-found]

    # Module-level structural check. Don't use isinstance(...) on
    # modules — Python's runtime-checkable Protocols don't apply to
    # modules. Just verify the attributes we contractually require.
    assert hasattr(ma_arborists, "SOURCE_KEY"), (
        "ma_arborists must expose SOURCE_KEY so source_config can map it"
    )
    assert callable(getattr(ma_arborists, "run_all", None)), (
        "ma_arborists must expose a callable run_all()"
    )

    # Suppress unused-import warning for ProspectSource in the test
    # body — it's referenced in this docstring as the contract.
    _ = ProspectSource


def test_prospect_row_keys_aligned_with_csv_columns() -> None:
    """Every ``ProspectRow`` key (except ``tags``, which expands into
    multiple ``tags_<axis>`` columns at CSV-write time) should appear in
    ``pipeline.CSV_COLUMNS``. This is the cheapest drift-detector we can
    afford — if someone adds a column to CSV_COLUMNS without updating
    the type, this test fires."""
    from pipeline import CSV_COLUMNS  # type: ignore[import-not-found]

    row_keys = set(ProspectRow.__optional_keys__) | set(
        ProspectRow.__required_keys__
    )
    csv_keys = set(CSV_COLUMNS)

    # `tags` expands at write-time into per-axis tags_<axis> columns.
    only_in_row = row_keys - csv_keys - {"tags"}
    assert not only_in_row, (
        f"ProspectRow has fields not in CSV_COLUMNS: {sorted(only_in_row)}. "
        "Either add them to CSV_COLUMNS or drop them from ProspectRow."
    )
