"""Tests for util.normalize (Socrata URL-type unwrapping)."""
from __future__ import annotations

from util.normalize import normalize_website


def test_plain_string_passthrough() -> None:
    assert normalize_website("https://example.com") == "https://example.com"


def test_strips_whitespace() -> None:
    assert normalize_website("  https://example.com  ") == "https://example.com"


def test_socrata_dict_with_url_key() -> None:
    assert normalize_website({"url": "https://x.com", "description": "link"}) == "https://x.com"


def test_socrata_dict_with_href_key() -> None:
    assert normalize_website({"href": "https://y.com"}) == "https://y.com"


def test_empty_dict_returns_none() -> None:
    assert normalize_website({}) is None


def test_none_returns_none() -> None:
    assert normalize_website(None) is None


def test_empty_string_returns_none() -> None:
    assert normalize_website("") is None
    assert normalize_website("   ") is None


def test_non_string_non_dict_returns_none() -> None:
    assert normalize_website(42) is None
    assert normalize_website(["https://x.com"]) is None
