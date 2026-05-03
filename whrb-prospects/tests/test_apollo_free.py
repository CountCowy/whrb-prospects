"""Tests for enrich.apollo_free.

Same pattern as test_hunter_free: monkeypatch ``_KEY`` and use
``responses`` to mock the Apollo POST endpoint.
"""
from __future__ import annotations

from typing import Any

import pytest
import responses

from enrich import apollo_free


@pytest.fixture
def apollo_key(monkeypatch: pytest.MonkeyPatch) -> str:
    monkeypatch.setattr(apollo_free, "_KEY", "test-apollo-key")
    return "test-apollo-key"


def _people_payload(people: list[dict[str, Any]]) -> dict[str, Any]:
    return {"people": people}


class TestFindDecisionMaker:
    def test_returns_none_when_key_missing(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(apollo_free, "_KEY", None)
        assert apollo_free.find_decision_maker("example.com") is None

    def test_returns_none_when_domain_empty(self, apollo_key: str) -> None:
        assert apollo_free.find_decision_maker("") is None

    @responses.activate
    def test_returns_none_on_non_200(self, apollo_key: str) -> None:
        responses.add(
            responses.POST,
            apollo_free.SEARCH_URL,
            status=401,
            json={"error": "unauthorized"},
        )
        assert apollo_free.find_decision_maker("example.com") is None

    @responses.activate
    def test_returns_none_when_no_people(self, apollo_key: str) -> None:
        responses.add(
            responses.POST,
            apollo_free.SEARCH_URL,
            status=200,
            json=_people_payload([]),
        )
        assert apollo_free.find_decision_maker("example.com") is None

    @responses.activate
    def test_returns_first_person(self, apollo_key: str) -> None:
        responses.add(
            responses.POST,
            apollo_free.SEARCH_URL,
            status=200,
            json=_people_payload(
                [
                    {
                        "name": "Jane Doe",
                        "title": "Founder",
                        "email": "jane@example.com",
                        "phone_numbers": [{"sanitized_number": "+16175550100"}],
                        "linkedin_url": "https://linkedin.com/in/jane",
                    }
                ]
            ),
        )
        result = apollo_free.find_decision_maker("example.com")
        assert result == {
            "contact_name": "Jane Doe",
            "contact_title": "Founder",
            "contact_email": "jane@example.com",
            "contact_phone": "+16175550100",
            "contact_linkedin": "https://linkedin.com/in/jane",
        }

    @responses.activate
    def test_handles_missing_phone_numbers(self, apollo_key: str) -> None:
        responses.add(
            responses.POST,
            apollo_free.SEARCH_URL,
            status=200,
            json=_people_payload([{"name": "Pat", "email": "pat@x.com"}]),
        )
        result = apollo_free.find_decision_maker("x.com")
        assert result is not None
        assert result["contact_phone"] is None

    @responses.activate
    def test_swallows_network_errors(self, apollo_key: str) -> None:
        responses.add(
            responses.POST,
            apollo_free.SEARCH_URL,
            body=ConnectionError("boom"),
        )
        assert apollo_free.find_decision_maker("example.com") is None


class TestEnrichRows:
    @responses.activate
    def test_only_targets_tier_a_rows_without_contact_name(self, apollo_key: str) -> None:
        rows = [
            {"company_name": "B-tier", "tier": "B", "website": "b.com"},
            {"company_name": "no-website", "tier": "A"},
            {"company_name": "already-has-contact", "tier": "A",
             "website": "x.com", "contact_name": "Existing"},
        ]
        # No HTTP calls expected — none of the rows are eligible.
        apollo_free.enrich_rows(rows, budget=10)
        for r in rows:
            assert "_contact_email_source" not in r

    @responses.activate
    def test_enriches_tier_a_row_and_stamps_provenance(self, apollo_key: str) -> None:
        responses.add(
            responses.POST,
            apollo_free.SEARCH_URL,
            status=200,
            json=_people_payload(
                [{"name": "Sam Doe", "title": "Owner", "email": "sam@target.com"}]
            ),
        )
        rows = [{"company_name": "Target", "tier": "A", "website": "target.com"}]
        apollo_free.enrich_rows(rows, budget=10)
        assert rows[0]["contact_email"] == "sam@target.com"
        assert rows[0]["_contact_email_source"] == "pipeline_apollo"
        assert "apollo;" in rows[0].get("pipeline_notes", "")

    @responses.activate
    def test_respects_budget(self, apollo_key: str) -> None:
        responses.add(
            responses.POST,
            apollo_free.SEARCH_URL,
            status=200,
            json=_people_payload([{"name": "Sam", "email": "sam@a.com"}]),
        )
        rows = [
            {"company_name": "A", "tier": "A", "website": "a.com"},
            {"company_name": "B", "tier": "A", "website": "b.com"},
        ]
        apollo_free.enrich_rows(rows, budget=1)
        enriched = [r for r in rows if r.get("contact_name")]
        assert len(enriched) == 1
