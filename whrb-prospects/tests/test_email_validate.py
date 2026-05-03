"""Tests for enrich.email_validate.

DNS lookups are mocked at the ``dns.resolver.resolve`` boundary so the
test suite stays offline-deterministic. The library boundary is the
right patch site — patching at the call site inside ``email_validate``
would silently break if the implementation is refactored.
"""
from __future__ import annotations

from collections.abc import Iterator
from unittest.mock import patch

import pytest

from enrich import email_validate


@pytest.fixture(autouse=True)
def reset_mx_cache() -> Iterator[None]:
    """Clear the module-level MX cache between tests.

    `_has_mx` memoises lookups for the lifetime of the process, so without
    this fixture two tests that probe the same domain would only see one
    `dns.resolver.resolve` call.
    """
    email_validate._MX_CACHE.clear()
    yield
    email_validate._MX_CACHE.clear()


class TestIsValid:
    def test_returns_false_for_empty_input(self) -> None:
        assert email_validate.is_valid("") is False
        assert email_validate.is_valid(None) is False

    def test_returns_false_for_syntactically_invalid(self) -> None:
        assert email_validate.is_valid("not-an-email") is False
        assert email_validate.is_valid("missing@tld") is False
        assert email_validate.is_valid("@no-local.com") is False

    def test_returns_true_when_mx_lookup_succeeds(self) -> None:
        with patch("dns.resolver.resolve") as resolve:
            # An MX-style answer set: anything truthy iter-able with at
            # least one element makes len(list(answers)) > 0.
            resolve.return_value = ["10 mx.example.com."]
            assert email_validate.is_valid("user@example.com") is True
            resolve.assert_called_once()

    def test_returns_false_when_mx_lookup_returns_no_records(self) -> None:
        with patch("dns.resolver.resolve") as resolve:
            resolve.return_value = []  # No MX records.
            assert email_validate.is_valid("user@example.com") is False

    def test_returns_false_when_dns_lookup_raises(self) -> None:
        with patch("dns.resolver.resolve", side_effect=Exception("NXDOMAIN")):
            assert email_validate.is_valid("user@nodomain.example") is False


class TestHasMxCaching:
    def test_repeated_lookup_hits_cache(self) -> None:
        with patch("dns.resolver.resolve") as resolve:
            resolve.return_value = ["10 mx.example.com."]
            email_validate._has_mx("example.com")
            email_validate._has_mx("example.com")
            email_validate._has_mx("example.com")
            assert resolve.call_count == 1, "MX lookups must be memoised"


class TestCleanRows:
    def test_replaces_invalid_emails_with_none(self) -> None:
        rows = [
            {"company_email": "bad-syntax", "contact_email": None, "sales_email": ""},
            {"company_email": "ok@example.com", "contact_email": None, "sales_email": None},
        ]
        with patch("dns.resolver.resolve") as resolve:
            resolve.return_value = ["10 mx.example.com."]
            email_validate.clean_rows(rows)
        assert rows[0]["company_email"] is None
        assert rows[1]["company_email"] == "ok@example.com"

    def test_skips_rows_without_email_fields(self) -> None:
        rows = [{"company_name": "ABC"}]
        # Should not raise, should not touch the row.
        email_validate.clean_rows(rows)
        assert rows == [{"company_name": "ABC"}]
