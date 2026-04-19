"""Tests for db.nonprofit_bmf (EIN formatting + suffix stripping)."""
from __future__ import annotations

from db.nonprofit_bmf import _format_ein, _match_key, _strip_suffix_tokens


class TestFormatEin:
    def test_9_digits_formatted(self) -> None:
        assert _format_ein("042103594") == "04-2103594"

    def test_accepts_messy_digits(self) -> None:
        assert _format_ein(" 04-210-3594 ") == "04-2103594"

    def test_short_digit_string_rejected(self) -> None:
        assert _format_ein("12345") is None

    def test_long_digit_string_rejected(self) -> None:
        assert _format_ein("0123456789") is None  # 10 digits, not 9

    def test_none_and_empty(self) -> None:
        assert _format_ein(None) is None
        assert _format_ein("") is None


class TestStripSuffixTokens:
    def test_strips_trustees_of_the(self) -> None:
        # "trustees of the museum of fine arts" → "fine arts"
        assert _strip_suffix_tokens("trustees of the museum of fine arts") == "fine arts"

    def test_strips_corporate_suffixes(self) -> None:
        assert _strip_suffix_tokens("acme inc") == "acme"
        assert _strip_suffix_tokens("acme llc") == "acme"
        assert _strip_suffix_tokens("acme corporation") == "acme"

    def test_strips_and_for_handel_case(self) -> None:
        # CLAUDE.md round-8: required for Handel & Haydn matching.
        assert _strip_suffix_tokens("handel and haydn society") == "handel haydn"

    def test_empty_input(self) -> None:
        assert _strip_suffix_tokens("") == ""

    def test_idempotent_on_clean_name(self) -> None:
        assert _strip_suffix_tokens("boston symphony orchestra") == "boston symphony orchestra"


class TestMatchKey:
    def test_none_yields_empty(self) -> None:
        assert _match_key(None) == ""

    def test_handel_variants_converge(self) -> None:
        # Proves the Stage 4 canonical spot-check: scraped "Handel & Haydn"
        # (from ArtsBoston) must key to the same bucket as BMF's
        # "HANDEL AND HAYDN SOCIETY".
        scraped = _match_key("Handel & Haydn")
        irs_side = _match_key("HANDEL AND HAYDN SOCIETY")
        assert scraped == irs_side

    def test_mfa_variants_converge(self) -> None:
        # Museum of Fine Arts has a "Trustees of the ..." BMF name.
        scraped = _match_key("Museum of Fine Arts")
        irs_side = _match_key("Trustees of the Museum of Fine Arts")
        assert scraped == irs_side
