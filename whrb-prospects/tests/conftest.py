"""Shared pytest fixtures for the whrb-prospects unit suite.

Every test runs with ``util.event_log`` stubbed to a no-op — the real module
would try to talk to Supabase on any ``warn``/``error`` call that slipped
through a validator, which would (a) slow tests dramatically and (b) silently
read live credentials from ``.env``. The fixture swaps in a minimal recorder
so tests can assert on emitted events when they care.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

# Ensure the repo root (whrb-prospects/) is importable when pytest is invoked
# from anywhere in the workspace.
_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

# Never let the test suite touch a real Supabase project.
os.environ.pop("SUPABASE_URL", None)
os.environ.pop("SUPABASE_SERVICE_ROLE_KEY", None)


class EventRecorder:
    """In-memory stand-in for ``util.event_log`` used by unit tests."""

    def __init__(self) -> None:
        self.events: list[dict] = []

    def _record(self, level: str, category: str, message: str = "", **kwargs: object) -> None:
        self.events.append(
            {"level": level, "category": category, "message": message, **kwargs}
        )

    def info(self, category: str, message: str = "", **kwargs: object) -> None:
        self._record("info", category, message, **kwargs)

    def warn(self, category: str, message: str = "", **kwargs: object) -> None:
        self._record("warn", category, message, **kwargs)

    def error(self, category: str, message: str = "", **kwargs: object) -> None:
        self._record("error", category, message, **kwargs)

    def fatal(self, category: str, message: str = "", **kwargs: object) -> None:
        self._record("fatal", category, message, **kwargs)

    def log(self, level: str, category: str, message: str = "", **kwargs: object) -> None:
        self._record(level, category, message, **kwargs)

    def flush(self) -> None:  # match real module shape
        return

    def set_pipeline_run_id(self, run_id: str | None) -> None:
        return

    def get_pipeline_run_id(self) -> str | None:
        return None

    def reset(self) -> None:
        self.events.clear()

    def by_category(self, category: str) -> list[dict]:
        return [e for e in self.events if e["category"] == category]


@pytest.fixture(autouse=True)
def stub_event_log(monkeypatch: pytest.MonkeyPatch) -> EventRecorder:
    """Replace every `util.event_log.*` attribute with an in-memory recorder.

    ``autouse=True`` so even tests that don't ask for the fixture stay off
    the network. Tests that want to assert on emitted events simply name
    ``stub_event_log`` in their signature.
    """
    recorder = EventRecorder()
    try:
        from util import event_log as real_event_log
    except ImportError:  # pragma: no cover — test harness failure
        return recorder
    for name in ("info", "warn", "error", "fatal", "log", "flush"):
        monkeypatch.setattr(real_event_log, name, getattr(recorder, name))
    monkeypatch.setattr(real_event_log, "set_pipeline_run_id", recorder.set_pipeline_run_id)
    monkeypatch.setattr(real_event_log, "get_pipeline_run_id", recorder.get_pipeline_run_id)
    return recorder
