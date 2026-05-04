"""Tests for enrich.contact_scraper.

Two layers of coverage:

* **Pure helpers** (``_classify_email``, ``_extract``, ``_has_usable_email``,
  ``_finalize``) — straight unit tests, no async.
* **Async plumbing** (``_scrape_site``, ``_enrich_async``,
  ``enrich_rows``) — driven via the project's ``asyncio_mode = "auto"``
  pytest config so ``async def test_*`` runs without per-test marker
  boilerplate. ``httpx.AsyncClient.get`` is patched with an
  ``AsyncMock`` that returns canned responses.
"""
from __future__ import annotations

from unittest.mock import AsyncMock

import httpx
import pytest

from enrich import contact_scraper

# -------------------------------------------------------------------------
# Pure helpers
# -------------------------------------------------------------------------


class TestClassifyEmail:
    @pytest.mark.parametrize(
        ("email", "expected"),
        [
            ("noreply@example.com", "junk"),
            ("no-reply@example.com", "junk"),
            ("wordpress@example.com", "junk"),
            ("example@example.com", "junk"),
            ("sales@example.com", "sales"),
            ("marketing@example.com", "sales"),
            ("sponsor@example.com", "sales"),
            ("info@example.com", "company"),
            ("hello@example.com", "company"),
            ("contact@example.com", "company"),
            ("jane.doe@example.com", "personal"),
        ],
    )
    def test_classification(self, email: str, expected: str) -> None:
        assert contact_scraper._classify_email(email) == expected


class TestExtract:
    def test_collects_emails_phones_and_name(self) -> None:
        # The trailing period after "Smith" forces NAME_LABEL_RE's
        # `\s+[A-Z][a-z]+` lookahead to fail — a period isn't whitespace,
        # so the {1,2} greedy match settles on exactly one trailing word.
        # That gives us a deterministic "Jane Smith" capture.
        html = """
        <p>Owner: Jane Smith. Founded the shop in 1992.</p>
        <p>For questions, write to jane@example.com</p>
        <p>or call (617) 555-0100.</p>
        """
        state: dict = {"emails": set(), "phones": set(), "name": None}
        contact_scraper._extract(html, "example.com", state)
        assert "jane@example.com" in state["emails"]
        assert any("617" in p for p in state["phones"])
        assert state["name"] == "Jane Smith"

    def test_filters_freemail_when_domain_doesnt_match(self) -> None:
        html = "<p>contact: support@gmail.com</p>"
        state: dict = {"emails": set(), "phones": set(), "name": None}
        contact_scraper._extract(html, "example.com", state)
        # gmail.com filtered out because it's not example.com
        assert state["emails"] == set()

    def test_keeps_freemail_when_domain_matches(self) -> None:
        html = "<p>contact: contact@gmail.com</p>"
        state: dict = {"emails": set(), "phones": set(), "name": None}
        contact_scraper._extract(html, "gmail.com", state)
        # Domain match — keep the address.
        assert "contact@gmail.com" in state["emails"]

    def test_rejects_bare_10_digit_run_in_visible_text(self) -> None:
        # The classic deebeff6 bug: ``2147483647`` is INT_MAX with a real
        # NPA prefix (Dallas 214). The pre-PR-B regex captured this and
        # collapsed four unrelated companies onto a shared business_key.
        # Visible-text matches must now require a separator between the
        # area code, exchange, and 4-digit subscriber number.
        html = "<script>const limit = 2147483647;</script>"
        state: dict = {"emails": set(), "phones": set(), "name": None}
        contact_scraper._extract(html, "example.com", state)
        assert state["phones"] == set()

    def test_rejects_phone_sentinel_with_separators(self) -> None:
        # Even when separators are present, the sentinel list catches
        # placeholder values like ``999-999-9999``.
        html = "<p>Call (999) 999-9999 for support.</p>"
        state: dict = {"emails": set(), "phones": set(), "name": None}
        contact_scraper._extract(html, "example.com", state)
        assert state["phones"] == set()

    def test_extracts_phone_from_tel_href_without_separators(self) -> None:
        # ``href="tel:..."`` is the one place a contiguous 10-digit string
        # is canonical — the protocol prefix supplies the missing context
        # so we still want the match.
        html = '<a href="tel:6175550100">Call us</a>'
        state: dict = {"emails": set(), "phones": set(), "name": None}
        contact_scraper._extract(html, "example.com", state)
        assert any("6175550100" in p for p in state["phones"])

    def test_skips_sentinel_inside_tel_href(self) -> None:
        # Defense-in-depth — the tel-href path consults the same sentinel
        # list so sites with placeholder ``tel:0000000000`` markup don't
        # poison the run.
        html = '<a href="tel:0000000000">placeholder</a>'
        state: dict = {"emails": set(), "phones": set(), "name": None}
        contact_scraper._extract(html, "example.com", state)
        assert state["phones"] == set()


class TestHasUsableEmail:
    def test_returns_true_for_personal_or_company(self) -> None:
        assert contact_scraper._has_usable_email({"jane@example.com"}) is True
        assert contact_scraper._has_usable_email({"info@example.com"}) is True
        assert contact_scraper._has_usable_email({"sales@example.com"}) is True

    def test_returns_false_for_junk_only(self) -> None:
        assert contact_scraper._has_usable_email({"noreply@example.com"}) is False
        assert contact_scraper._has_usable_email(set()) is False


class TestFinalize:
    def test_classifies_into_three_buckets(self) -> None:
        state = {
            "emails": {"sales@x.com", "info@x.com", "owner@x.com"},
            "phones": {"617-555-0100"},
            "name": "Pat Owner",
        }
        out = contact_scraper._finalize(state)
        assert out["sales_email"] == "sales@x.com"
        assert out["company_email"] == "info@x.com"
        assert out["contact_email"] == "owner@x.com"
        assert out["contact_name"] == "Pat Owner"
        assert out["contact_phone"] == "617-555-0100"

    def test_company_email_falls_back_to_sales_or_personal(self) -> None:
        # No company-style email; finalize falls through to sales then
        # personal so company_email is never empty when any address is found.
        state = {
            "emails": {"sales@x.com", "owner@x.com"},
            "phones": set(),
            "name": None,
        }
        out = contact_scraper._finalize(state)
        assert out["company_email"] == "sales@x.com"

    def test_omits_phone_when_empty(self) -> None:
        out = contact_scraper._finalize(
            {"emails": set(), "phones": set(), "name": None}
        )
        assert "contact_phone" not in out


# -------------------------------------------------------------------------
# Async plumbing
# -------------------------------------------------------------------------


def _mk_response(status: int, text: str = "", content_type: str = "text/html"):
    """Build a minimal httpx.Response stand-in for AsyncMock returns."""
    req = httpx.Request("GET", "https://example.com")
    return httpx.Response(status, text=text, headers={"content-type": content_type}, request=req)


class TestFetch:
    async def test_returns_text_on_html_200(self) -> None:
        client = AsyncMock(spec=httpx.AsyncClient)
        client.get.return_value = _mk_response(200, "<p>hi</p>")
        out = await contact_scraper._fetch(client, "https://example.com")
        assert out == "<p>hi</p>"

    async def test_returns_none_on_non_200(self) -> None:
        client = AsyncMock(spec=httpx.AsyncClient)
        client.get.return_value = _mk_response(404)
        out = await contact_scraper._fetch(client, "https://example.com")
        assert out is None

    async def test_returns_none_for_non_html_content(self) -> None:
        client = AsyncMock(spec=httpx.AsyncClient)
        client.get.return_value = _mk_response(200, "raw", content_type="application/pdf")
        out = await contact_scraper._fetch(client, "https://example.com/file.pdf")
        assert out is None

    async def test_returns_none_when_get_raises(self) -> None:
        client = AsyncMock(spec=httpx.AsyncClient)
        client.get.side_effect = httpx.TimeoutException("slow")
        out = await contact_scraper._fetch(client, "https://example.com")
        assert out is None


class TestScrapeSite:
    async def test_returns_empty_dict_when_url_unparseable(self) -> None:
        client = AsyncMock(spec=httpx.AsyncClient)
        import asyncio as _asyncio
        sem = _asyncio.Semaphore(1)
        # ``normalize_website`` returns None for falsy input → early exit.
        assert await contact_scraper._scrape_site(client, sem, None) == {}
        assert await contact_scraper._scrape_site(client, sem, "") == {}

    async def test_returns_empty_when_netloc_missing(self) -> None:
        client = AsyncMock(spec=httpx.AsyncClient)
        import asyncio as _asyncio
        sem = _asyncio.Semaphore(1)
        # A string with no netloc parses to '' under urlparse — should
        # return an empty dict before the HTTP loop.
        assert await contact_scraper._scrape_site(client, sem, "https://") == {}

    async def test_walks_paths_until_usable_email_found(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # First call returns a junk-only page; second returns a usable
        # company-style email so the loop short-circuits.
        async def fake_fetch(_client, url):
            if url.endswith("/contact"):
                return "<p>email: info@target.com</p>"
            return "<p>email: noreply@target.com</p>"

        monkeypatch.setattr(contact_scraper, "_fetch", fake_fetch)
        client = AsyncMock(spec=httpx.AsyncClient)
        import asyncio as _asyncio
        sem = _asyncio.Semaphore(1)
        result = await contact_scraper._scrape_site(
            client, sem, "https://target.com"
        )
        assert result.get("company_email") == "info@target.com"


class TestEnrichRows:
    async def test_skips_rows_without_website_or_already_enriched(self) -> None:
        rows = [
            {"company_name": "no-site"},
            {"company_name": "has-contact", "website": "x.com",
             "contact_email": "x@x.com"},
            {"company_name": "has-company", "website": "y.com",
             "company_email": "y@y.com"},
        ]
        # No need to mock — _enrich_async returns early when no eligible rows.
        await contact_scraper._enrich_async(rows)
        # Nothing was mutated.
        assert "_contact_email_source" not in rows[0]
        assert rows[1]["contact_email"] == "x@x.com"
        assert rows[2]["company_email"] == "y@y.com"

    async def test_enriches_eligible_row(self, monkeypatch: pytest.MonkeyPatch) -> None:
        async def fake_scrape(_client, _sem, _url):
            return {
                "company_email": "info@target.com",
                "sales_email": None,
                "contact_email": "owner@target.com",
                "contact_name": "Target Owner",
                "contact_phone": "617-555-0100",
            }

        monkeypatch.setattr(contact_scraper, "_scrape_site", fake_scrape)
        rows = [{"company_name": "Target", "website": "target.com"}]
        await contact_scraper._enrich_async(rows)
        assert rows[0]["company_email"] == "info@target.com"
        assert rows[0]["contact_email"] == "owner@target.com"
        assert rows[0]["_contact_email_source"] == "pipeline_scraper"

    async def test_swallows_per_row_exceptions(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        async def boom(_client, _sem, _url):
            raise RuntimeError("network gremlins")

        monkeypatch.setattr(contact_scraper, "_scrape_site", boom)
        rows = [{"company_name": "X", "website": "x.com"}]
        # Must not raise — gather() with return_exceptions=True ate the error.
        await contact_scraper._enrich_async(rows)
        assert "_contact_email_source" not in rows[0]


def test_enrich_rows_sync_wrapper(monkeypatch: pytest.MonkeyPatch) -> None:
    """The sync wrapper just dispatches to ``asyncio.run(_enrich_async(...))``."""
    captured = {}

    async def fake_async(rows):
        captured["rows"] = rows

    monkeypatch.setattr(contact_scraper, "_enrich_async", fake_async)
    rows = [{"company_name": "x"}]
    contact_scraper.enrich_rows(rows)
    assert captured["rows"] is rows
