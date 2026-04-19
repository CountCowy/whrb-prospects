"""Tests for util.checkpoint (atomic writes + TTL + resume-or-rebuild)."""
from __future__ import annotations

import time
from pathlib import Path

import pytest

from util import checkpoint


@pytest.fixture
def isolated_cache(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Swap the module-level checkpoint dirs onto a per-test tmp_path."""
    chk = tmp_path / "checkpoints"
    src = tmp_path / "sources"
    monkeypatch.setattr(checkpoint, "CHECKPOINT_DIR", chk)
    monkeypatch.setattr(checkpoint, "SOURCES_DIR", src)
    return tmp_path


class TestSaveAndLoadSource:
    def test_save_then_load_round_trip(self, isolated_cache: Path) -> None:
        rows = [{"company_name": "A"}, {"company_name": "B"}]
        checkpoint.save_source("osm", rows)
        loaded = checkpoint.load_source("osm")
        assert loaded == rows

    def test_missing_source_returns_none(self, isolated_cache: Path) -> None:
        assert checkpoint.load_source("nonexistent") is None

    def test_stale_source_returns_none(
        self, isolated_cache: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        checkpoint.save_source("osm", [{"a": 1}])
        # Pretend the file is older than TTL.
        monkeypatch.setattr(
            checkpoint,
            "TTL_SECONDS",
            -1,
        )
        assert checkpoint.load_source("osm") is None


class TestSavePhaseAndLoadLatest:
    def test_save_phase_writes_expected_file(self, isolated_cache: Path) -> None:
        rows = [{"k": "v"}]
        checkpoint.save_phase("01_collected", rows)
        path = checkpoint.CHECKPOINT_DIR / "01_collected.json"
        assert path.exists()

    def test_load_latest_returns_highest_ordinal(self, isolated_cache: Path) -> None:
        checkpoint.save_phase("01_collected", [{"x": 1}])
        # Slight delay so mtime ordering is deterministic on some filesystems.
        time.sleep(0.01)
        checkpoint.save_phase("03_contact_scraped", [{"x": 2}])
        phase_order = [
            "01_collected",
            "02_filtered_deduped",
            "03_contact_scraped",
        ]
        name, rows = checkpoint.load_latest(phase_order)
        assert name == "03_contact_scraped"
        assert rows == [{"x": 2}]

    def test_load_latest_ignores_unknown_phase(self, isolated_cache: Path) -> None:
        checkpoint.save_phase("99_stale_schema", [{"x": 1}])
        name, rows = checkpoint.load_latest(["01_collected"])
        assert (name, rows) == (None, None)

    def test_load_latest_returns_none_when_empty(self, isolated_cache: Path) -> None:
        assert checkpoint.load_latest(["01_collected"]) == (None, None)


class TestClearAll:
    def test_clears_both_dirs(self, isolated_cache: Path) -> None:
        checkpoint.save_phase("01_collected", [{"k": 1}])
        checkpoint.save_source("osm", [{"k": 2}])
        checkpoint.clear_all()
        assert list(checkpoint.CHECKPOINT_DIR.glob("*.json")) == []
        assert list(checkpoint.SOURCES_DIR.glob("*.json")) == []


class TestAtomicWriteJson:
    def test_leaves_no_tmp_file_on_success(self, isolated_cache: Path) -> None:
        checkpoint.save_source("osm", [{"a": 1}])
        tmps = list(checkpoint.SOURCES_DIR.glob("*.tmp"))
        assert tmps == []
