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
    def test_empty_row(self) -> None:
        assert pipeline.score({}) == 0

    def test_website_and_phone_add(self) -> None:
        s = pipeline.score({"website": "x.com", "company_phone": "617-1", "tier": "C"})
        # has_website(20) + has_phone(10) + tier_C(5) == 35
        assert s == 35

    def test_tier_a_highest(self) -> None:
        assert pipeline.score({"tier": "A"}) == 30

    def test_chamber_member_bonus(self) -> None:
        s = pipeline.score({"pipeline_notes": "chamber member"})
        assert s == 15

    def test_review_count_log_scales(self) -> None:
        s1 = pipeline.score({"review_count": 10})
        s2 = pipeline.score({"review_count": 10000})
        assert s2 > s1


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
