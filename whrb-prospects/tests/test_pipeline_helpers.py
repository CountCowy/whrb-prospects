"""Tests for pipeline.py orchestration helpers (score, seasonality, _safe_cached)."""
from __future__ import annotations

from pathlib import Path

import pytest

import pipeline
from util import checkpoint


@pytest.fixture
def isolated_cache(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setattr(checkpoint, "CHECKPOINT_DIR", tmp_path / "checkpoints")
    monkeypatch.setattr(checkpoint, "SOURCES_DIR", tmp_path / "sources")
    return tmp_path


class TestScore:
    """T4 score() v2 (SCORE_WEIGHTS_V2_LAUNCH=True).

    Tier provides the dominant base prior. Tag axes (sector / genre /
    affiliation / cadence / daypart_fit / operating_model) each add +1
    when present; history adds +1; harvard/mit affiliation adds +1;
    compliance penalises -20 per value. The legacy V1 signals (website,
    chamber, review_count) no longer contribute under V2 — those tests
    have been retired.
    """

    def test_empty_row(self) -> None:
        assert pipeline.score({}) == 0

    def test_tier_only(self) -> None:
        assert pipeline.score({"tier": "A"}) == 30
        assert pipeline.score({"tier": "B"}) == 15
        assert pipeline.score({"tier": "C"}) == 5

    def test_budget_signal_tag_each_adds_one(self) -> None:
        # Tier B (15) + sector(+1) + genre(+1) + cadence(+1) = 18.
        s = pipeline.score(
            {
                "tier": "B",
                "tags": {
                    "sector": ["arts"],
                    "genre": ["classical"],
                    "cadence": ["term_driven"],
                },
            }
        )
        assert s == 18

    def test_history_present_bonus(self) -> None:
        # Tier B (15) + history(+1) = 16.
        s = pipeline.score({"tier": "B", "tags": {"history": ["wcrb_sponsor"]}})
        assert s == 16

    def test_harvard_mit_affiliation_bonus(self) -> None:
        # Affiliation is NOT a budget-signal axis (it has its own +1 path
        # for harvard/mit specifically). Tier C (5) + harvard(+1) = 6.
        s = pipeline.score(
            {"tier": "C", "tags": {"affiliation": ["harvard_affiliated"]}}
        )
        assert s == 6
        # MIT affiliation behaves the same.
        s2 = pipeline.score(
            {"tier": "C", "tags": {"affiliation": ["mit_affiliated"]}}
        )
        assert s2 == 6
        # Other affiliations don't add the +1.
        s3 = pipeline.score(
            {"tier": "C", "tags": {"affiliation": ["greater_boston"]}}
        )
        assert s3 == 5

    def test_compliance_penalty(self) -> None:
        # Tier B (15) - 20 = -5; two compliance values = -25.
        single = pipeline.score(
            {"tier": "B", "tags": {"compliance": ["political"]}}
        )
        assert single == -5
        double = pipeline.score(
            {"tier": "B", "tags": {"compliance": ["political", "alcohol"]}}
        )
        assert double == -25


class TestSeasonality:
    def test_default_is_year_round(self) -> None:
        assert pipeline.seasonality_for(None) == "year-round"
        assert pipeline.seasonality_for("") == "year-round"
        assert pipeline.seasonality_for("restaurant") == "year-round"

    def test_known_categories(self) -> None:
        assert pipeline.seasonality_for("landscaping") == "spring"
        assert pipeline.seasonality_for("Snow Removal") == "fall"
        assert pipeline.seasonality_for("hvac") == "spring/fall"


class TestSafeCached:
    def test_returns_rows_on_success(self, isolated_cache: Path) -> None:
        result = pipeline._safe_cached("osm", lambda: [{"company_name": "X"}])
        assert result == [{"company_name": "X"}]

    def test_second_call_hits_cache(
        self, isolated_cache: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # Force a fresh save, then confirm the fn is not invoked the second time.
        pipeline._safe_cached("osm", lambda: [{"company_name": "first"}])
        called = {"n": 0}

        def _should_not_run() -> list[dict]:
            called["n"] += 1
            return []

        second = pipeline._safe_cached("osm", _should_not_run)
        assert called["n"] == 0
        assert second == [{"company_name": "first"}]

    def test_exception_returns_empty_list_not_none(
        self, isolated_cache: Path, stub_event_log
    ) -> None:
        def _boom() -> list[dict]:
            raise RuntimeError("scraper died")

        result = pipeline._safe_cached("boom", _boom)
        assert result == []
        # Callers must never see None; this is the silent-failure guard.
        assert isinstance(result, list)
        assert stub_event_log.by_category("source_failed")

    def test_exception_source_is_not_cached(
        self, isolated_cache: Path, stub_event_log
    ) -> None:
        """A failed fetch must not poison the checkpoint — a retry should actually retry."""

        def _boom() -> list[dict]:
            raise RuntimeError("scraper died")

        pipeline._safe_cached("boom", _boom)
        attempts = {"n": 0}

        def _succeeds() -> list[dict]:
            attempts["n"] += 1
            return [{"company_name": "recovered"}]

        second = pipeline._safe_cached("boom", _succeeds)
        assert attempts["n"] == 1
        assert second == [{"company_name": "recovered"}]


class TestFilterZips:
    def test_keeps_whrb_zips(self) -> None:
        rows = [{"zip": "02138"}, {"zip": "02139"}]
        assert pipeline.filter_zips(rows) == rows

    def test_keeps_rows_without_zip(self) -> None:
        rows = [{"zip": ""}, {"zip": None}]
        assert pipeline.filter_zips(rows) == rows

    def test_drops_out_of_region(self) -> None:
        rows = [{"zip": "90210"}]
        assert pipeline.filter_zips(rows) == []
