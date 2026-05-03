"""Tests for enrich.hunter_free.

`hunter_free._KEY` is read from the env at module-load time. We
monkeypatch the module-level attribute directly rather than re-importing,
which keeps the tests independent of import order.

`responses` mocks the `requests` HTTP layer so no live API calls fire
in CI.
"""
from __future__ import annotations

from typing import Any

import pytest
import responses

from enrich import hunter_free


@pytest.fixture
def hunter_key(monkeypatch: pytest.MonkeyPatch) -> str:
    """Set a stable fake key for the duration of a test."""
    monkeypatch.setattr(hunter_free, "_KEY", "test-hunter-key")
    return "test-hunter-key"


def _hunter_payload(emails: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    return {"data": {"emails": emails or []}}


class TestDomainSearch:
    def test_returns_none_when_key_missing(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(hunter_free, "_KEY", None)
        assert hunter_free.domain_search("example.com") is None

    def test_returns_none_when_domain_empty(self, hunter_key: str) -> None:
        assert hunter_free.domain_search("") is None

    @responses.activate
    def test_returns_none_on_non_200(self, hunter_key: str) -> None:
        responses.add(
            responses.GET,
            "https://api.hunter.io/v2/domain-search",
            status=401,
            json={"error": "unauthorized"},
        )
        assert hunter_free.domain_search("example.com") is None

    @responses.activate
    def test_returns_none_when_no_emails(self, hunter_key: str) -> None:
        responses.add(
            responses.GET,
            "https://api.hunter.io/v2/domain-search",
            status=200,
            json=_hunter_payload([]),
        )
        assert hunter_free.domain_search("example.com") is None

    @responses.activate
    def test_returns_top_email_payload(self, hunter_key: str) -> None:
        responses.add(
            responses.GET,
            "https://api.hunter.io/v2/domain-search",
            status=200,
            json=_hunter_payload(
                [
                    {
                        "first_name": "Jane",
                        "last_name": "Doe",
                        "position": "Owner",
                        "value": "jane@example.com",
                        "linkedin": "https://linkedin.com/in/jane",
                    },
                    {  # Hunter returns more than one — we should take the first.
                        "first_name": "Bob",
                        "last_name": "Smith",
                        "value": "bob@example.com",
                    },
                ]
            ),
        )
        result = hunter_free.domain_search("example.com")
        assert result == {
            "contact_name": "Jane Doe",
            "contact_title": "Owner",
            "contact_email": "jane@example.com",
            "contact_linkedin": "https://linkedin.com/in/jane",
        }

    @responses.activate
    def test_swallows_network_errors(self, hunter_key: str) -> None:
        # No `responses.add` => a ConnectionError is raised when the
        # mock library sees an unregistered request. The `except` arm
        # in domain_search must coerce that into None.
        responses.add(
            responses.GET,
            "https://api.hunter.io/v2/domain-search",
            body=ConnectionError("boom"),
        )
        assert hunter_free.domain_search("example.com") is None


class TestEnrichRows:
    @responses.activate
    def test_skips_rows_without_website_or_wrong_tier(self, hunter_key: str) -> None:
        rows = [
            {"company_name": "no-site", "tier": "A"},
            {"company_name": "tier-c", "tier": "C", "website": "https://c.example"},
            {"company_name": "already-has-email", "tier": "A",
             "website": "https://x.example", "contact_email": "x@x.example"},
        ]
        # Hunter must not be called for any of these — so no responses
        # registered. If it tries to fetch we'd get an unregistered-URL error.
        hunter_free.enrich_rows(rows, budget=10)
        # No mutation should have happened.
        assert "_contact_email_source" not in rows[0]
        assert "_contact_email_source" not in rows[1]
        assert rows[2]["contact_email"] == "x@x.example"

    @responses.activate
    def test_enriches_eligible_row_and_marks_provenance(self, hunter_key: str) -> None:
        responses.add(
            responses.GET,
            "https://api.hunter.io/v2/domain-search",
            status=200,
            json=_hunter_payload(
                [{"first_name": "Pat", "last_name": "Lee", "position": "CEO",
                  "value": "pat@target.com"}]
            ),
        )
        rows = [{"company_name": "Target", "tier": "A", "website": "target.com"}]
        hunter_free.enrich_rows(rows, budget=10)
        assert rows[0]["contact_email"] == "pat@target.com"
        assert rows[0]["contact_name"] == "Pat Lee"
        assert rows[0]["_contact_email_source"] == "pipeline_hunter"
        # Pipeline-notes append should fire.
        assert "hunter;" in rows[0].get("pipeline_notes", "")

    @responses.activate
    def test_respects_budget(self, hunter_key: str) -> None:
        responses.add(
            responses.GET,
            "https://api.hunter.io/v2/domain-search",
            status=200,
            json=_hunter_payload([{"value": "a@a.com"}]),
        )
        # Three eligible rows but budget=1.
        rows = [
            {"company_name": "A", "tier": "A", "website": "a.com"},
            {"company_name": "B", "tier": "A", "website": "b.com"},
            {"company_name": "C", "tier": "A", "website": "c.com"},
        ]
        hunter_free.enrich_rows(rows, budget=1)
        # Only one row got enriched.
        enriched = [r for r in rows if r.get("contact_email")]
        assert len(enriched) == 1

    @responses.activate
    def test_normalizes_socrata_dict_website(self, hunter_key: str) -> None:
        responses.add(
            responses.GET,
            "https://api.hunter.io/v2/domain-search",
            status=200,
            json=_hunter_payload([{"value": "x@socrata.example"}]),
        )
        rows = [
            {
                "company_name": "Socrata Site",
                "tier": "A",
                "website": {"url": "https://socrata.example", "description": "link"},
            }
        ]
        hunter_free.enrich_rows(rows, budget=10)
        # Website should now be the normalized string, not the dict.
        assert rows[0]["website"] == "https://socrata.example"
        assert rows[0]["contact_email"] == "x@socrata.example"
