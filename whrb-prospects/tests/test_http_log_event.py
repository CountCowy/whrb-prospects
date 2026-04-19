"""Tests for util.http._log_event — must never re-raise, even when logging fails."""
from __future__ import annotations

import sys
from io import StringIO

import pytest

from util import http


def test_log_event_delegates_to_event_log(stub_event_log) -> None:
    http._log_event("warn", "scrape_4xx", message="HTTP 404 test", url="https://x")
    event = stub_event_log.by_category("scrape_4xx")[0]
    assert event["level"] == "warn"
    assert event["message"] == "HTTP 404 test"
    assert event["url"] == "https://x"


def test_log_event_swallows_downstream_exception(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """If the imported event_log raises, _log_event must still return cleanly."""
    def _boom(*_a: object, **_k: object) -> None:
        raise RuntimeError("logger asploded")

    from util import event_log

    monkeypatch.setattr(event_log, "warn", _boom)

    captured = StringIO()
    monkeypatch.setattr(sys, "stderr", captured)

    # Must not raise.
    http._log_event("warn", "scrape_4xx", message="test")

    # And must have surfaced the failure to stderr for operators.
    assert "_log_event" in captured.getvalue()
    assert "RuntimeError" in captured.getvalue()


def test_log_event_never_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    """Even with invalid args, _log_event must return cleanly — the smart_retry
    exhaustion path depends on this."""
    # Use a level the real module doesn't expose (AttributeError inside) and
    # confirm nothing propagates.
    http._log_event("not_a_real_level", "scrape_4xx", message="test")
