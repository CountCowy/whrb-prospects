"""Tests for db.validators (EIN + phone sanity checks)."""
from __future__ import annotations

from db.validators import VALID_NANP_AREA_CODES, validate_ein, validate_phone


class TestValidateEIN:
    def test_valid_ein_passes_through(self) -> None:
        assert validate_ein("04-2103594") == "04-2103594"

    def test_none_is_silent(self, stub_event_log) -> None:
        assert validate_ein(None) is None
        assert stub_event_log.events == []

    def test_empty_string_is_silent(self, stub_event_log) -> None:
        assert validate_ein("") is None
        assert validate_ein("   ") is None
        assert stub_event_log.events == []

    def test_whitespace_is_stripped(self) -> None:
        assert validate_ein("  04-2103594  ") == "04-2103594"

    def test_bare_digits_rejected(self, stub_event_log) -> None:
        assert validate_ein("042103594") is None
        assert len(stub_event_log.by_category("ein_invalid")) == 1

    def test_wrong_hyphen_position_rejected(self, stub_event_log) -> None:
        assert validate_ein("042-103594") is None
        assert stub_event_log.by_category("ein_invalid")

    def test_letters_rejected(self, stub_event_log) -> None:
        assert validate_ein("AB-1234567") is None
        assert stub_event_log.by_category("ein_invalid")

    def test_warn_context_carries_business_key(self, stub_event_log) -> None:
        validate_ein("garbage", business_key="phone:6174953400")
        event = stub_event_log.by_category("ein_invalid")[0]
        assert event["context"]["business_key"] == "phone:6174953400"
        assert event["context"]["ein"] == "garbage"


class TestValidatePhone:
    def test_common_formatting_preserved(self) -> None:
        assert validate_phone("(617) 495-3400") == "(617) 495-3400"
        assert validate_phone("617-495-3400") == "617-495-3400"
        assert validate_phone("617.495.3400") == "617.495.3400"

    def test_digits_only_preserved(self) -> None:
        assert validate_phone("6174953400") == "6174953400"

    def test_leading_country_code_ok(self) -> None:
        # 11 digits — still ≥10, keep the original formatting.
        assert validate_phone("+1 617-495-3400") == "+1 617-495-3400"

    def test_short_phone_rejected(self, stub_event_log) -> None:
        assert validate_phone("555-1234") is None
        assert stub_event_log.by_category("phone_invalid")

    def test_letters_only_rejected(self, stub_event_log) -> None:
        assert validate_phone("call me") is None
        assert stub_event_log.by_category("phone_invalid")

    def test_none_is_silent(self, stub_event_log) -> None:
        assert validate_phone(None) is None
        assert stub_event_log.events == []

    def test_empty_is_silent(self, stub_event_log) -> None:
        assert validate_phone("") is None
        assert validate_phone("   ") is None
        assert stub_event_log.events == []

    def test_warn_context_carries_business_key(self, stub_event_log) -> None:
        validate_phone("911", business_key="name:test|02138")
        event = stub_event_log.by_category("phone_invalid")[0]
        assert event["context"]["business_key"] == "name:test|02138"
        assert event["context"]["phone"] == "911"

    def test_nanp_invalid_area_code_rejected(self, stub_event_log) -> None:
        # The actual Reagle Music Theater bug: scraper produced bare 10-digit
        # strings 1145128678, 5275619254, 1776892274. None of those area
        # codes (114, 527, 177) is a real NANP NPA — all must be rejected.
        assert validate_phone("1145128678") is None
        assert validate_phone("5275619254") is None
        assert validate_phone("1776892274") is None
        events = stub_event_log.by_category("phone_nanp_invalid")
        assert len(events) == 3
        # Each event records the offending area code for /admin/logs.
        assert {e["context"]["area_code"] for e in events} == {"114", "527", "177"}

    def test_nanp_valid_geographic_codes_pass(self) -> None:
        # 617 (Boston), 857 (Boston overlay), 213 (LA), 212 (NYC) — all real.
        assert validate_phone("(617) 495-3400") == "(617) 495-3400"
        assert validate_phone("857-555-0100") == "857-555-0100"
        assert validate_phone("213.555.0123") == "213.555.0123"
        assert validate_phone("+1 (212) 555-9876") == "+1 (212) 555-9876"

    def test_nanp_toll_free_codes_accepted(self) -> None:
        # User confirmed: toll-free counts as valid NANP for keying purposes.
        for tf_prefix in ("800", "833", "844", "855", "866", "877", "888"):
            phone = f"1-{tf_prefix}-555-1212"
            assert validate_phone(phone) == phone, f"toll-free {tf_prefix} should pass"

    def test_nanp_premium_900_rejected(self, stub_event_log) -> None:
        # 900-series (premium-rate) is intentionally not in the allowlist —
        # it's never a legit business contact for this pipeline.
        assert validate_phone("1-900-555-1212") is None
        events = stub_event_log.by_category("phone_nanp_invalid")
        assert events and events[0]["context"]["area_code"] == "900"

    def test_nanp_event_distinct_from_phone_invalid(self, stub_event_log) -> None:
        # Short-phone rejection still uses the "phone_invalid" category;
        # NANP rejection uses "phone_nanp_invalid". Categories must not collide
        # so /admin/logs can chart the two failure modes separately.
        validate_phone("555-1234")  # too short → phone_invalid
        validate_phone("114-555-0100")  # bad NPA → phone_nanp_invalid
        assert len(stub_event_log.by_category("phone_invalid")) == 1
        assert len(stub_event_log.by_category("phone_nanp_invalid")) == 1


class TestNANPAllowlist:
    def test_boston_area_codes_present(self) -> None:
        # Sanity check the WHRB strong-signal area codes are all in the set.
        for code in ("617", "857", "508", "774", "413", "978", "781"):
            assert code in VALID_NANP_AREA_CODES

    def test_known_invalid_codes_absent(self) -> None:
        # The actual hallucinated codes from the Reagle bug must be absent.
        for code in ("114", "177", "527", "000", "111", "555"):
            assert code not in VALID_NANP_AREA_CODES

    def test_set_is_immutable(self) -> None:
        # frozenset guards against accidental mutation at import time.
        assert isinstance(VALID_NANP_AREA_CODES, frozenset)
