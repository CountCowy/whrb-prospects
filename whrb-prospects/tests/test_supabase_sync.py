"""Tests for db.supabase_sync helpers — no network, no Supabase client."""
from __future__ import annotations

import math

import pytest

from db.supabase_sync import (
    _apply_field_validators,
    _as_str,
    _build_insert,
    _coerce,
    _patch_existing,
    _split_alt_fields,
    business_key,
)


class TestAsStr:
    def test_none(self) -> None:
        assert _as_str(None) is None

    def test_nan(self) -> None:
        assert _as_str(math.nan) is None

    def test_empty_whitespace(self) -> None:
        assert _as_str("   ") is None
        assert _as_str("") is None

    def test_numbers_become_strings(self) -> None:
        assert _as_str(42) == "42"

    def test_strips(self) -> None:
        assert _as_str("  hi  ") == "hi"


class TestCoerce:
    def test_nan_becomes_none(self) -> None:
        assert _coerce(math.nan) is None

    def test_empty_string_becomes_none(self) -> None:
        assert _coerce("") is None
        assert _coerce("   ") is None

    def test_number_passes_through(self) -> None:
        assert _coerce(3) == 3
        assert _coerce(2.5) == 2.5


class TestBusinessKey:
    def test_phone_key_wins(self) -> None:
        bk = business_key({"company_name": "X", "company_phone": "(617) 495-3400"})
        assert bk == "phone:6174953400"

    def test_contact_phone_fallback(self) -> None:
        bk = business_key({"company_name": "X", "contact_phone": "617-495-3400"})
        assert bk == "phone:6174953400"

    def test_name_zip_when_no_phone(self) -> None:
        bk = business_key({"company_name": "Cafe Luna", "zip": "02139"})
        assert bk == "name:cafe luna|02139"

    def test_short_phone_falls_through_to_name(self) -> None:
        bk = business_key({"company_name": "Cafe", "company_phone": "123", "zip": "02138"})
        assert bk == "name:cafe|02138"

    def test_name_only(self) -> None:
        assert business_key({"company_name": "Solo"}) == "name:solo"

    def test_returns_none_when_nothing_usable(self) -> None:
        assert business_key({"zip": "02138"}) is None


class TestSplitAltFields:
    def test_splits_alt_prefix(self) -> None:
        base, alt = _split_alt_fields(
            {"company_name": "X", "website": "x.com", "alt_website": "y.com"}
        )
        assert base == {"company_name": "X", "website": "x.com"}
        assert alt == {"website": "y.com"}


class TestApplyFieldValidators:
    def test_valid_row_no_rejections(self) -> None:
        payload = {
            "ein": "04-2103594",
            "company_phone": "(617) 495-3400",
            "contact_phone": None,
        }
        assert _apply_field_validators(payload, "phone:6174953400") == 0
        assert payload["ein"] == "04-2103594"
        assert payload["company_phone"] == "(617) 495-3400"

    def test_malformed_ein_becomes_none_and_counts(self, stub_event_log) -> None:
        payload = {"ein": "garbage", "company_phone": "617-495-3400"}
        rej = _apply_field_validators(payload, "phone:6174953400")
        assert rej == 1
        assert payload["ein"] is None
        assert stub_event_log.by_category("ein_invalid")

    def test_malformed_phone_counts(self, stub_event_log) -> None:
        payload = {"ein": None, "company_phone": "555", "contact_phone": None}
        rej = _apply_field_validators(payload, "name:test|02138")
        assert rej == 1
        assert payload["company_phone"] is None
        assert stub_event_log.by_category("phone_invalid")

    def test_multiple_rejections_counted_separately(self, stub_event_log) -> None:
        payload = {"ein": "bad", "company_phone": "x", "contact_phone": "y"}
        rej = _apply_field_validators(payload, "name:test|02138")
        assert rej == 3


class TestBuildInsert:
    def test_builds_complete_payload(self) -> None:
        row = {"company_name": "X", "website": "x.com", "priority_score": 42}
        payload, rej = _build_insert(row, "name:x", {}, "2026-04-19T00:00:00+00:00")
        assert payload["business_key"] == "name:x"
        assert payload["created_source"] == "pipeline"
        assert payload["company_name"] == "X"
        assert payload["priority_score"] == 42
        assert payload["pipeline_last_seen_at"] == "2026-04-19T00:00:00+00:00"
        assert rej == 0

    def test_review_count_coerced_to_int(self) -> None:
        payload, _ = _build_insert(
            {"company_name": "X", "review_count": "123"}, "name:x", {}, "t"
        )
        assert payload["review_count"] == 123

    def test_bad_review_count_falls_back_to_none(self) -> None:
        payload, _ = _build_insert(
            {"company_name": "X", "review_count": "not a number"}, "name:x", {}, "t"
        )
        assert payload["review_count"] is None


class TestPatchExisting:
    def test_locked_field_skipped(self) -> None:
        row = {"company_name": "ScrapedName"}
        existing = {"id": "abc", "user_overrides": {"company_name": True}}
        patch, _ = _patch_existing(row, existing, {}, "t", "name:test")
        assert "company_name" not in patch

    def test_composite_is_nonprofit_locks_ein_and_source(self) -> None:
        row = {"is_nonprofit": True, "ein": "04-2103594", "nonprofit_source": "irs_bmf"}
        existing = {"id": "abc", "user_overrides": {"is_nonprofit": True}}
        patch, _ = _patch_existing(row, existing, {}, "t", "name:test")
        assert "is_nonprofit" not in patch
        assert "ein" not in patch
        assert "nonprofit_source" not in patch

    def test_priority_score_refreshed_when_unlocked(self) -> None:
        row = {"priority_score": 99}
        patch, _ = _patch_existing(row, {"user_overrides": {}}, {}, "t", "name:t")
        assert patch["priority_score"] == 99

    def test_priority_score_locked_skipped(self) -> None:
        row = {"priority_score": 99}
        patch, _ = _patch_existing(
            row, {"user_overrides": {"priority_score": True}}, {}, "t", "name:t"
        )
        assert "priority_score" not in patch

    def test_none_value_does_not_overwrite(self) -> None:
        row = {"company_phone": None, "company_name": "X"}
        patch, _ = _patch_existing(row, {"user_overrides": {}}, {}, "t", "name:x")
        assert "company_phone" not in patch

    def test_invalid_phone_flows_to_validator(self, stub_event_log) -> None:
        row = {"company_phone": "555"}
        patch, rej = _patch_existing(row, {"user_overrides": {}}, {}, "t", "name:x")
        assert rej == 1
        assert patch["company_phone"] is None
