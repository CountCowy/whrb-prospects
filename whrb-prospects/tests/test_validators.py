"""Tests for db.validators (EIN + phone sanity checks)."""
from __future__ import annotations

from db.validators import validate_ein, validate_phone


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
