"""Tests for enrich.dedupe (normalizers + merge + the main dedupe pass)."""
from __future__ import annotations

from enrich.dedupe import (
    _best_tier,
    _completeness,
    _fuzz_threshold,
    _merge,
    _norm_name,
    _norm_phone,
    _zip_compatible,
    dedupe,
)


class TestNormName:
    def test_empty(self) -> None:
        assert _norm_name(None) == ""
        assert _norm_name("") == ""

    def test_lowercase_and_strips_punct(self) -> None:
        assert _norm_name("Felipe's Taqueria, Inc.") == "felipes taqueria inc"

    def test_collapses_whitespace(self) -> None:
        assert _norm_name("  Cafe   Luna  ") == "cafe luna"

    def test_unicode_tolerated(self) -> None:
        # Accented chars survive (_norm_name only strips [^\w\s]) and lowercase.
        assert _norm_name("Café Rüen") == "café rüen"


class TestNormPhone:
    def test_strips_formatting(self) -> None:
        assert _norm_phone("(617) 495-3400") == "6174953400"

    def test_takes_last_ten(self) -> None:
        assert _norm_phone("+1 617 495 3400") == "6174953400"

    def test_empty(self) -> None:
        assert _norm_phone(None) == ""
        assert _norm_phone("") == ""

    def test_letters_stripped(self) -> None:
        # _norm_phone keeps every digit from the input and returns the last 10.
        # Input digits: "617495340012" → trailing 10 → "7495340012".
        assert _norm_phone("call 617-495-3400 ext 12") == "7495340012"


class TestBestTier:
    def test_a_beats_b(self) -> None:
        assert _best_tier("A", "B") == "A"
        assert _best_tier("B", "A") == "A"

    def test_b_beats_c(self) -> None:
        assert _best_tier("B", "C") == "B"

    def test_unknown_loses_to_ranked(self) -> None:
        assert _best_tier("?", "B") == "B"

    def test_both_unknown_returns_first_non_empty(self) -> None:
        assert _best_tier("X", "Y") == "X"
        assert _best_tier(None, "Y") == "Y"


class TestCompleteness:
    def test_counts_truthy_values(self) -> None:
        assert _completeness({"a": 1, "b": "", "c": None, "d": "x"}) == 2


class TestZipCompatible:
    def test_matching_zips_allow(self) -> None:
        assert _zip_compatible("02138", "02138") is True

    def test_mismatched_zips_block(self) -> None:
        assert _zip_compatible("02138", "02139") is False

    def test_missing_zip_permits(self) -> None:
        assert _zip_compatible(None, "02138") is True
        assert _zip_compatible("02138", None) is True
        assert _zip_compatible(None, None) is True


class TestFuzzThreshold:
    def test_same_zip_is_lenient(self) -> None:
        assert _fuzz_threshold("02138", "02138") == 92

    def test_missing_zip_is_strict(self) -> None:
        assert _fuzz_threshold(None, "02138") == 97
        assert _fuzz_threshold("02138", None) == 97
        assert _fuzz_threshold(None, None) == 97


class TestMerge:
    def test_winner_is_more_complete(self) -> None:
        a = {"company_name": "X", "website": "", "company_phone": ""}
        b = {"company_name": "X", "website": "x.com", "company_phone": "617-555-0100"}
        merged = _merge(a, b)
        assert merged["website"] == "x.com"
        assert merged["company_phone"] == "617-555-0100"

    def test_conflicting_preserved_field_goes_to_alt(self) -> None:
        a = {"company_name": "X", "website": "a.com", "source": "osm"}
        b = {"company_name": "X", "website": "b.com", "source": "yelp"}
        merged = _merge(a, b)
        # winner/loser depend on completeness tie-break; both websites should survive.
        survivors = {merged.get("website"), merged.get("alt_website")}
        assert "a.com" in survivors and "b.com" in survivors

    def test_tier_upgrades_independent_of_completeness(self) -> None:
        a = {"company_name": "X", "tier": "C", "website": "a.com", "company_phone": "1"}
        b = {"company_name": "X", "tier": "A"}
        merged = _merge(a, b)
        assert merged["tier"] == "A"

    def test_sources_are_unioned_and_sorted(self) -> None:
        a = {"company_name": "X", "source": "yelp"}
        b = {"company_name": "X", "source": "osm"}
        merged = _merge(a, b)
        assert merged["source"] == "osm,yelp"

    def test_loser_fills_missing_on_winner(self) -> None:
        a = {"company_name": "X", "website": "x.com", "company_phone": "1"}
        b = {"company_name": "X", "category": "restaurant"}
        merged = _merge(a, b)
        assert merged["category"] == "restaurant"


class TestDedupePass:
    def test_phone_match_merges(self) -> None:
        rows = [
            {"company_name": "Cafe A", "company_phone": "(617) 495-3400", "source": "osm"},
            {"company_name": "Cafe A Inc", "company_phone": "617-495-3400", "source": "yelp"},
        ]
        out = dedupe(rows)
        assert len(out) == 1
        assert "osm" in out[0]["source"] and "yelp" in out[0]["source"]

    def test_fuzzy_name_same_zip_merges(self) -> None:
        # Names differ only by a trailing period — fuzz.ratio ≥ 92 with matching ZIP.
        rows = [
            {"company_name": "Cafe Luna Bistro", "zip": "02139", "source": "osm"},
            {"company_name": "Cafe Luna Bistro.", "zip": "02139", "source": "yelp"},
        ]
        out = dedupe(rows)
        assert len(out) == 1
        assert "osm" in out[0]["source"] and "yelp" in out[0]["source"]

    def test_fuzzy_name_different_zips_do_not_merge(self) -> None:
        rows = [
            {"company_name": "Cafe Luna", "zip": "02139"},
            {"company_name": "Cafe Luna", "zip": "02138"},
        ]
        out = dedupe(rows)
        assert len(out) == 2

    def test_rows_without_name_dropped(self) -> None:
        rows = [{"company_name": "", "zip": "02138"}]
        out = dedupe(rows)
        assert out == []
