"""Tests for util.event_log — buffer, flush, per-event timestamping.

The autouse ``stub_event_log`` fixture in ``conftest.py`` replaces the
real module's helpers with an in-memory recorder for *most* tests. These
tests reach for the real module to verify its internal behavior.
"""
from __future__ import annotations

import time
from datetime import UTC, datetime

import pytest


@pytest.fixture
def real_event_log(monkeypatch: pytest.MonkeyPatch):
    """Restore the real ``util.event_log`` (the autouse stub patches it).

    Also stub the supabase client so flush is a no-op — we only inspect
    the buffered rows, never reach the network.
    """
    import importlib

    from util import event_log as real

    # Roll back the stubs the autouse fixture installed so we can test the
    # real ``log`` / ``flush`` plumbing.
    importlib.reload(real)

    # Don't actually hit Supabase on flush.
    monkeypatch.setattr(real, "_client", lambda: None)
    real._BUFFER.clear()
    real._PIPELINE_RUN_ID = None
    yield real
    real._BUFFER.clear()


class TestPerEventTimestamping:
    """Run dc3cd1ab proved every event in a flush batch shared the SAME
    ``created_at`` (the DB column's ``default now()`` fires once per INSERT
    statement). The fix stamps ``created_at`` at emit time in Python so
    each event's timeline position survives the batched write.
    """

    def test_log_records_created_at_per_event(self, real_event_log) -> None:
        before = datetime.now(tz=UTC)
        real_event_log.info("test_cat", "first message")
        after = datetime.now(tz=UTC)

        assert len(real_event_log._BUFFER) == 1
        row = real_event_log._BUFFER[0]
        assert "created_at" in row, (
            "log() must stamp created_at at emit time so the DB default "
            "doesn't collapse a flush batch onto one timestamp."
        )
        ts = datetime.fromisoformat(row["created_at"])
        assert before <= ts <= after

    def test_two_events_get_distinct_timestamps(self, real_event_log) -> None:
        # The bug we're fixing: every event in a flush batch shared the
        # flush time. With per-event stamping, two emits separated by even
        # a few microseconds carry different created_at values.
        real_event_log.info("test_cat", "message 1")
        time.sleep(0.001)  # 1ms — well above the resolution of UTC isoformat
        real_event_log.info("test_cat", "message 2")

        ts1 = datetime.fromisoformat(real_event_log._BUFFER[0]["created_at"])
        ts2 = datetime.fromisoformat(real_event_log._BUFFER[1]["created_at"])
        assert ts1 < ts2, (
            "Two events emitted ~1ms apart must carry distinct timestamps; "
            "shared timestamps would mean the DB default fired instead of "
            "our per-event stamp."
        )

    def test_burst_of_events_has_monotonic_timestamps(self, real_event_log) -> None:
        # Simulate a phase emitting many events in quick succession.
        for i in range(20):
            real_event_log.info("burst_cat", f"event {i}")

        timestamps = [
            datetime.fromisoformat(r["created_at"])
            for r in real_event_log._BUFFER
        ]
        # Emit order is preserved AND timestamps are non-decreasing.
        assert timestamps == sorted(timestamps)
        # And they're not all identical — that would be the regression.
        assert len(set(timestamps)) > 1, (
            "20 events emitted in a tight loop produced only one distinct "
            "timestamp; the per-event stamp is missing or always evaluating "
            "to the same value."
        )

    def test_iso_format_is_timezone_aware(self, real_event_log) -> None:
        # Postgres timestamptz expects ISO 8601 with timezone info; without
        # the offset, the inserted value would be interpreted as the
        # session's TIME ZONE, producing wrong timestamps in the UI.
        real_event_log.warn("tz_check", "test")
        ts_str = real_event_log._BUFFER[0]["created_at"]
        # Either ``+00:00`` or ``Z`` is acceptable; both encode UTC.
        assert ts_str.endswith("+00:00") or ts_str.endswith("Z"), (
            f"created_at {ts_str!r} is missing a timezone offset; Postgres "
            "timestamptz needs explicit UTC marking to avoid silent shift."
        )
