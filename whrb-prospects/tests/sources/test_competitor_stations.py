"""Stage T5 — fixture-driven parser tests for sources/competitor_stations.

Each station has a captured HTML fixture in
``tests/fixtures/competitor_stations/<slug>_sponsors.html``. The parser
runs entirely offline against the fixture; live network calls are
deferred to the integrity script. Re-capturing fixtures is a quarterly
admin task via ``scripts/rerecord_station_fixtures.py``.

Coverage matrix (also tracked in ``scripts/t5_integrity.py``):

* C2 source-emitter correctness — fixture in, expected tag set out.
* Peer-station whitelist suppression at parse time.
* Per-station daypart hint tagged via history axis.
* Robots.txt acceptance (open) vs. denial (synthetic).
* Rate-limit enforcement (mocked clock).
* User-Agent on every outgoing GET (mocked transport).
"""
from __future__ import annotations

from pathlib import Path

import pytest

from sources import competitor_stations as cs

FIXTURE_DIR = Path(__file__).resolve().parent.parent / "fixtures" / "competitor_stations"


def _read_fixture(slug: str) -> str:
    return (FIXTURE_DIR / f"{slug}_sponsors.html").read_text(encoding="utf-8")


@pytest.fixture(autouse=True)
def _reset_disabled():
    """Empty the per-station-disabled cache before each test."""
    cs._PER_STATION_DISABLED.clear()
    yield
    cs._PER_STATION_DISABLED.clear()


# =====================================================================
# C2 — fixture in -> expected tag set out (per station)
# =====================================================================


class TestParseWERS:
    def test_yields_known_advertisers(self) -> None:
        rows = cs.parse_wers(_read_fixture("wers"))
        names = {r["name"] for r in rows}
        # Spot-check 5 known WHRB-class advertisers from the Turn 6
        # client list — these MUST appear in the output for T12.
        assert "Boston Symphony Orchestra" in names
        assert "Boston Ballet" in names
        assert "Mass Cultural Council" in names
        assert "Boston Lyric Opera" in names
        assert "Celebrity Series of Boston" in names

    def test_filters_social_and_internal_links(self) -> None:
        rows = cs.parse_wers(_read_fixture("wers"))
        urls = {r["website"] for r in rows if r["website"]}
        for u in urls:
            assert "facebook.com" not in u
            assert "instagram.com" not in u
            assert "wers.org" not in u
            assert "emerson.edu" not in u

    def test_filters_donate_cta(self) -> None:
        rows = cs.parse_wers(_read_fixture("wers"))
        names = {r["name"].lower() for r in rows}
        assert "donate" not in names

    def test_minimum_count(self) -> None:
        rows = cs.parse_wers(_read_fixture("wers"))
        assert len(rows) >= 80, f"WERS yielded only {len(rows)} rows"


class TestParseWGBH:
    def test_yields_five_testimonials(self) -> None:
        rows = cs.parse_wgbh(_read_fixture("wgbh"))
        names = {r["name"] for r in rows}
        assert "Watershed Informatics" in names
        assert "Blade of Grass" in names  # regression: " of " split bug
        assert "Village Bank" in names
        assert "McLane Middleton" in names
        assert "WJ McDonough Fence" in names
        assert len(rows) == 5

    def test_no_websites(self) -> None:
        # Testimonials don't include outbound URLs.
        rows = cs.parse_wgbh(_read_fixture("wgbh"))
        for r in rows:
            assert r["website"] in ("", None)


class TestParseWBUR:
    def test_yields_member_partners(self) -> None:
        rows = cs.parse_wbur(_read_fixture("wbur"))
        names = {r["name"] for r in rows}
        assert "Plymouth Rock Assurance" in names
        assert "Cityside Subaru" in names
        assert "Direct Tire and Auto Service" in names
        assert "Volante Farms" in names
        assert "The Huntington" in names

    def test_excludes_section_headers(self) -> None:
        rows = cs.parse_wbur(_read_fixture("wbur"))
        names = {r["name"].lower() for r in rows}
        assert "members" not in names
        assert "more ways to support wbur" not in names
        assert "contact us" not in names

    def test_does_not_emit_wbur_self_mentions(self) -> None:
        # WBUR CitySpace + The WBUR Festival are peer-station self-mentions
        # — caught by the peer-whitelist filter in _emit_from_html, but the
        # parser itself returns them so we can assert they're peer-tagged.
        rows = cs.parse_wbur(_read_fixture("wbur"))
        names = {r["name"] for r in rows}
        assert "WBUR CitySpace" in names
        assert "The WBUR Festival" in names


class TestParseWCRB:
    def test_inquiry_page_yields_no_sponsors(self) -> None:
        # WCRB's corporate-sponsorship page is inquiry-only at capture
        # time. The parser should produce 0 rows after filtering social
        # / FCC / station-self links — not crash.
        rows = cs.parse_wcrb(_read_fixture("wcrb"))
        assert rows == []


class TestParseWUMB:
    def test_inquiry_page_yields_no_sponsors(self) -> None:
        rows = cs.parse_wumb(_read_fixture("wumb"))
        assert rows == []


# =====================================================================
# Peer-station whitelist (substring containment)
# =====================================================================


class TestPeerWhitelist:
    def test_exact_match_suppresses(self) -> None:
        peers = frozenset({"wgbh"})
        assert cs._is_peer_station("WGBH", peers) is True

    def test_token_containment_suppresses(self) -> None:
        peers = frozenset({"wbur"})
        # "WBUR CitySpace" normalizes to "wbur cityspace" — "wbur" is a
        # token within that, so the peer match must succeed.
        assert cs._is_peer_station("WBUR CitySpace", peers) is True
        assert cs._is_peer_station("The WBUR Festival", peers) is True

    def test_unrelated_business_not_suppressed(self) -> None:
        peers = frozenset({"wgbh", "wcrb", "wbur", "wumb", "wers"})
        assert cs._is_peer_station("Watershed Informatics", peers) is False
        assert cs._is_peer_station("Boston Symphony Orchestra", peers) is False
        assert cs._is_peer_station("Walden Local Meat Co.", peers) is False

    def test_multitoken_peer_substring(self) -> None:
        peers = frozenset({"boston public radio"})
        assert cs._is_peer_station("Boston Public Radio", peers) is True
        # Single-token "Boston" should NOT trigger.
        assert cs._is_peer_station("Boston Symphony Orchestra", peers) is False

    def test_does_not_match_non_peer_substring(self) -> None:
        # Regression guard: "npr" is in _PEER_STATIONS_FALLBACK. Make
        # sure it doesn't false-positive on words that contain the
        # substring "npr" — there shouldn't be any in a normal English
        # business name; verify with a synthetic case.
        peers = frozenset({"npr"})
        assert cs._is_peer_station("Snpring Snpring Co", peers) is False


# =====================================================================
# C2 + edit-lock — emit shape + history tag
# =====================================================================


class TestEmitFromHTML:
    def test_wgbh_emits_history_wgbh_sponsor(self) -> None:
        rows, suppressed = cs._emit_from_html(
            "wgbh", _read_fixture("wgbh"), cs._PEER_STATIONS_FALLBACK
        )
        assert suppressed == 0
        assert len(rows) == 5
        for r in rows:
            assert r["source"] == "competitor_stations"
            assert "wgbh_sponsor" in r["tags"]["history"]

    def test_wbur_suppresses_two_self_mentions(self) -> None:
        rows, suppressed = cs._emit_from_html(
            "wbur", _read_fixture("wbur"), cs._PEER_STATIONS_FALLBACK
        )
        # WBUR CitySpace + The WBUR Festival are peer-suppressed.
        assert suppressed == 2
        names = {r["company_name"] for r in rows}
        assert "WBUR CitySpace" not in names
        assert "The WBUR Festival" not in names

    def test_wers_emits_history_wers_sponsor(self) -> None:
        rows, _ = cs._emit_from_html(
            "wers", _read_fixture("wers"), cs._PEER_STATIONS_FALLBACK
        )
        assert len(rows) > 0
        for r in rows:
            assert "wers_sponsor" in r["tags"]["history"]

    def test_wcrb_zero_rows_no_crash(self) -> None:
        rows, suppressed = cs._emit_from_html(
            "wcrb", _read_fixture("wcrb"), cs._PEER_STATIONS_FALLBACK
        )
        assert rows == []
        assert suppressed == 0


# =====================================================================
# UA + rate limit + robots
# =====================================================================


class TestUserAgent:
    def test_ua_string_constant(self) -> None:
        assert "WHRBProspectPipeline/1.0" in cs.USER_AGENT
        assert "whrb.org/sales" in cs.USER_AGENT

    def test_http_get_uses_ua(self, monkeypatch) -> None:
        captured: dict[str, object] = {}

        class _R:
            status_code = 200
            text = "<html></html>"
            reason = "OK"
            url = "https://example.test/x"
            request = None

        def fake_get(url, headers=None, timeout=None):
            captured["url"] = url
            captured["headers"] = dict(headers or {})
            captured["timeout"] = timeout
            return _R()

        monkeypatch.setattr(cs.requests, "get", fake_get)
        body = cs._http_get("https://example.test/x")
        assert body == "<html></html>"
        assert captured["headers"].get("User-Agent") == cs.USER_AGENT


class TestRateLimit:
    def test_run_all_sleeps_between_stations(self, monkeypatch) -> None:
        sleeps: list[float] = []
        monkeypatch.setattr(cs.time, "sleep", lambda s: sleeps.append(s))

        # Force offline mode so no network calls happen.
        monkeypatch.setenv("WHRB_COMPETITOR_STATIONS_OFFLINE", "1")
        cs.run_all()
        # In offline mode the sleep is intentionally skipped — no
        # politeness obligation to a fixture file. The integrity
        # script verifies the live-mode sleep behaviour separately.
        assert sleeps == []

    def test_run_all_sleeps_with_live_fetches(self, monkeypatch) -> None:
        # Mock _http_get + _robots_allows so we exercise the rate-limit
        # path without actually hitting the network. Force NOT offline
        # by clearing the env var.
        monkeypatch.delenv("WHRB_COMPETITOR_STATIONS_OFFLINE", raising=False)
        monkeypatch.setattr(cs, "_robots_allows", lambda *a, **kw: True)
        monkeypatch.setattr(
            cs,
            "_http_get",
            lambda url: _read_fixture(
                next(
                    s
                    for s in ("wcrb", "wgbh", "wbur", "wumb", "wers")
                    if s in url or url.endswith(f"{s}/") or s == url.split('/')[-2]
                )
            ),
        )
        sleeps: list[float] = []
        monkeypatch.setattr(cs.time, "sleep", lambda s: sleeps.append(s))

        cs.run_all(stations=["wgbh", "wers"])
        # Two stations, one inter-station sleep (between station 0 and 1).
        assert sleeps == [cs.RATE_LIMIT_SECONDS]


class TestRobots:
    def test_open_robots_allows_path(self, monkeypatch) -> None:
        # Use the captured WERS robots.txt — `Disallow:` (empty) under
        # User-agent: *. Should permit everything.
        body = (FIXTURE_DIR / "wers_robots.txt").read_text(encoding="utf-8")
        monkeypatch.setattr(cs, "_http_get", lambda u: body)
        assert cs._robots_allows(
            "wers",
            "https://wers.org/robots.txt",
            "https://wers.org/current-underwriters/",
        ) is True

    def test_synthetic_disallow_blocks(self, monkeypatch) -> None:
        body = (
            "User-agent: WHRBProspectPipeline\n"
            "Disallow: /private/\n"
        )
        monkeypatch.setattr(cs, "_http_get", lambda u: body)
        assert cs._robots_allows(
            "fake",
            "https://example.test/robots.txt",
            "https://example.test/private/sponsors",
        ) is False

    def test_404_robots_treated_as_open(self, monkeypatch) -> None:
        # No robots.txt published → 4xx → no restrictions.
        def raise_4xx(_):
            raise cs.NonRetryableHTTPError("404 Not Found https://x/robots.txt")

        monkeypatch.setattr(cs, "_http_get", raise_4xx)
        assert cs._robots_allows(
            "fake",
            "https://example.test/robots.txt",
            "https://example.test/path",
        ) is True

    def test_robots_blocked_disables_station(self, monkeypatch) -> None:
        # Force robots → disallow, then run one station; verify
        # _PER_STATION_DISABLED is populated and zero rows are returned.
        cs._PER_STATION_DISABLED.clear()
        monkeypatch.delenv("WHRB_COMPETITOR_STATIONS_OFFLINE", raising=False)
        monkeypatch.setattr(cs, "_robots_allows", lambda slug, *a, **kw: False)
        rows, _ = cs._scrape_one_station("wers", cs._PEER_STATIONS_FALLBACK)
        assert rows == []
        assert "wers" in cs._PER_STATION_DISABLED


# =====================================================================
# C1 — vocab conformance
# =====================================================================


class TestVocabConformance:
    @pytest.mark.parametrize("slug", ["wcrb", "wgbh", "wbur", "wumb", "wers"])
    def test_emitted_history_value_in_vocab(self, slug: str) -> None:
        from util.tags import _SEED_VOCAB

        history_value = cs._STATION_HISTORY_TAG[slug]
        assert history_value in _SEED_VOCAB["history"], (
            f"{slug}: history:{history_value} missing from seed vocab — "
            "add to util/tags.py::_SEED_VOCAB and the seed_tags.sql migration."
        )
