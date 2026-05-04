"""Defensive-behavior tests for sources.ma_sos.enrich_rows.

The browser-driving path is exercised by integration runs; here we focus on
the bail-out heuristics that prevent a broken upstream from starving the
pipeline's wall-clock budget.
"""
from __future__ import annotations

from typing import Any

import pytest

from sources import ma_sos


@pytest.fixture
def fake_browser(monkeypatch: pytest.MonkeyPatch) -> None:
    """Replace ``sync_playwright`` so we never launch Chromium in unit tests."""

    class _NullPage:
        pass

    class _NullContext:
        def new_page(self) -> _NullPage:
            return _NullPage()

    class _NullBrowser:
        def new_context(self) -> _NullContext:
            return _NullContext()

        def close(self) -> None:
            return

    class _NullPlaywright:
        # Mirror Playwright's lowercase `chromium` attribute. The
        # `headless=True` default exists only to match Playwright's
        # public signature so production callers can pass it through.
        class chromium:
            @staticmethod
            def launch(headless: bool = True) -> _NullBrowser:
                del headless
                return _NullBrowser()

    class _NullCtxMgr:
        def __enter__(self) -> _NullPlaywright:
            return _NullPlaywright()

        def __exit__(self, *exc: object) -> None:
            return None

    monkeypatch.setattr(ma_sos, "sync_playwright", lambda: _NullCtxMgr())


def _row(name: str, tier: str = "A") -> dict[str, Any]:
    return {"company_name": name, "tier": tier, "contact_name": None}


def test_enrich_rows_aborts_after_consecutive_selector_misses(
    monkeypatch: pytest.MonkeyPatch,
    fake_browser: None,
    stub_event_log,
) -> None:
    """Three back-to-back selector misses should trigger an early abort."""
    calls: list[str] = []

    def boom(_page, name):
        calls.append(name)
        raise ma_sos._SelectorMissing("locator timeout")

    monkeypatch.setattr(ma_sos, "_lookup_on_page", boom)

    rows = [_row(f"Company {i}") for i in range(10)]
    ma_sos.enrich_rows(rows, limit=10)

    # Only MAX_CONSECUTIVE_SELECTOR_FAILURES lookups should run before aborting.
    assert len(calls) == ma_sos.MAX_CONSECUTIVE_SELECTOR_FAILURES
    assert all(r.get("contact_name") is None for r in rows)

    # First miss + abort event were both emitted; later misses stayed silent.
    assert len(stub_event_log.by_category("ma_sos_selector_missing")) == 1
    assert len(stub_event_log.by_category("ma_sos_aborted")) == 1


def test_enrich_rows_resets_consecutive_counter_on_success(
    monkeypatch: pytest.MonkeyPatch,
    fake_browser: None,
    stub_event_log,
) -> None:
    """A successful lookup between misses must reset the consecutive count."""
    sequence = iter([
        ma_sos._SelectorMissing("miss 1"),
        {"officers": [{"title": "President", "name": "Jane Doe"}]},
        ma_sos._SelectorMissing("miss 2"),
        ma_sos._SelectorMissing("miss 3"),
        {"officers": [{"title": "Manager", "name": "John Roe"}]},
    ])

    def stub(_page, name):
        out = next(sequence)
        if isinstance(out, Exception):
            raise out
        return out

    monkeypatch.setattr(ma_sos, "_lookup_on_page", stub)

    rows = [_row(f"Company {i}") for i in range(5)]
    ma_sos.enrich_rows(rows, limit=5)

    # All five lookups attempted; abort threshold never reached.
    assert rows[1]["contact_name"] == "Jane Doe"
    assert rows[4]["contact_name"] == "John Roe"
    assert stub_event_log.by_category("ma_sos_aborted") == []
    # Only the very first miss is logged — subsequent misses stay quiet.
    assert len(stub_event_log.by_category("ma_sos_selector_missing")) == 1


class _FakePage:
    """Minimal Page stand-in. Each method consults its keyword to decide
    whether to raise (configured per test) or return."""

    def __init__(self, goto_raises: Exception | None = None,
                 fill_raises: Exception | None = None) -> None:
        self._goto_raises = goto_raises
        self._fill_raises = fill_raises

    def goto(self, *_args, **_kwargs) -> None:
        if self._goto_raises is not None:
            raise self._goto_raises

    def fill(self, *_args, **_kwargs) -> None:
        if self._fill_raises is not None:
            raise self._fill_raises


def test_lookup_on_page_raises_selector_missing_on_playwright_timeout() -> None:
    """A Playwright TimeoutError from goto/fill must surface as
    _SelectorMissing — the type-based catch replaced fragile string
    matching on ``str(e)`` (review follow-up)."""
    from playwright.sync_api import TimeoutError as PT

    page = _FakePage(fill_raises=PT("Timeout 5000ms exceeded."))
    with pytest.raises(ma_sos._SelectorMissing):
        ma_sos._lookup_on_page(page, "Test Co")  # type: ignore[arg-type]

    page = _FakePage(goto_raises=PT("Timeout 15000ms exceeded."))
    with pytest.raises(ma_sos._SelectorMissing):
        ma_sos._lookup_on_page(page, "Test Co")  # type: ignore[arg-type]


def test_lookup_on_page_returns_none_on_non_timeout_error() -> None:
    """Non-timeout exceptions (network reset, page closed, etc.) keep the
    pre-existing return-None behavior — only timeouts are bail signals."""
    page = _FakePage(goto_raises=RuntimeError("net::ERR_NAME_NOT_RESOLVED"))
    assert ma_sos._lookup_on_page(page, "Test Co") is None  # type: ignore[arg-type]


def test_enrich_rows_stops_when_wall_budget_exhausted(
    monkeypatch: pytest.MonkeyPatch,
    fake_browser: None,
    stub_event_log,
) -> None:
    """Crossing MAX_TOTAL_WALL_SECONDS aborts the loop with a budget event."""
    # Sequence: [start_time, iter0_check, iter1_check_overshoots]
    fake_clock = iter([0.0, 0.1, ma_sos.MAX_TOTAL_WALL_SECONDS + 5.0])
    monkeypatch.setattr(ma_sos.time, "monotonic", lambda: next(fake_clock))

    calls: list[str] = []

    def quick(_page, name):
        calls.append(name)
        return {"officers": [{"title": "President", "name": f"Owner of {name}"}]}

    monkeypatch.setattr(ma_sos, "_lookup_on_page", quick)

    rows = [_row(f"Company {i}") for i in range(5)]
    ma_sos.enrich_rows(rows, limit=5)

    # First iteration runs (clock at 0.1s); second iteration's pre-check
    # sees the simulated overshoot and aborts.
    assert len(calls) == 1
    assert len(stub_event_log.by_category("ma_sos_budget_exhausted")) == 1
