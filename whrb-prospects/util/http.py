"""Shared HTTP helpers: smart retry + status classifier.

Retries should only happen for transient failures (5xx, 429, network errors).
4xx responses are permanent and must NOT be retried.

Stage 2 logging: non-retryable 4xx responses emit ``scrape_4xx`` at
``warn`` level; retry exhaustion emits ``scrape_http`` at ``error``. Log
emission is fire-and-forget and must never raise back into the caller.
"""
from __future__ import annotations

import sys
from typing import Any

import requests
from tenacity import (
    Retrying,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)


class RetryableHTTPError(Exception):
    """5xx or 429 — worth retrying."""


class NonRetryableHTTPError(Exception):
    """4xx — permanent failure."""


RETRYABLE_EXCEPTIONS = (
    RetryableHTTPError,
    requests.ConnectionError,
    requests.Timeout,
    requests.ReadTimeout,
    requests.ConnectTimeout,
)


def _log_event(level: str, category: str, **kwargs: Any) -> None:
    """Fire-and-forget event emission.

    The local ``from util import event_log`` is intentional — importing it at
    module top would create a load-time cycle (``event_log`` imports
    ``supabase`` which may pull ``requests``, which transitively loops back
    here on some platforms). Any exception raised while logging is swallowed
    *but* surfaced to stderr so operators can see catastrophic logger
    failures without letting them crash the scraper.
    """
    try:
        from util import event_log

        getattr(event_log, level)(category, kwargs.pop("message", ""), **kwargs)
    except Exception as exc:
        print(
            f"[util.http._log_event] suppressed {type(exc).__name__}: {exc}",
            file=sys.stderr,
        )


def raise_for_smart_status(response: requests.Response) -> None:
    """Replacement for response.raise_for_status() that classifies errors."""
    code = response.status_code
    if code == 429 or (500 <= code < 600):
        raise RetryableHTTPError(f"{code} {response.reason} {response.url}")
    if 400 <= code < 500:
        _log_event(
            "warn",
            "scrape_4xx",
            message=f"HTTP {code} {response.reason}",
            url=str(response.url),
            http_status=code,
            context={"method": response.request.method if response.request else None},
        )
        raise NonRetryableHTTPError(f"{code} {response.reason} {response.url}")


def smart_retry(max_attempts: int = 3, wait_min: int = 2, wait_max: int = 20):
    """Decorator: retries only on transient failures, bounded backoff.

    On retry exhaustion, emits ``scrape_http`` at ``error`` level with the
    exception type and attempt count before re-raising.
    """

    def _decorator(fn):
        def _wrapped(*args, **kwargs):
            last_exc: Exception | None = None
            attempts = 0
            try:
                for attempt in Retrying(
                    stop=stop_after_attempt(max_attempts),
                    wait=wait_exponential(min=wait_min, max=wait_max),
                    retry=retry_if_exception_type(RETRYABLE_EXCEPTIONS),
                    reraise=True,
                ):
                    with attempt:
                        attempts = attempt.retry_state.attempt_number
                        return fn(*args, **kwargs)
            except RETRYABLE_EXCEPTIONS as e:
                last_exc = e
                _log_event(
                    "error",
                    "scrape_http",
                    message=f"retry exhausted after {attempts} attempts: {type(e).__name__}: {e}",
                    context={
                        "attempts": attempts,
                        "exception": type(e).__name__,
                        "fn": getattr(fn, "__qualname__", fn.__name__),
                        "detail": str(e)[:500],
                    },
                )
                raise
            # Unreachable, but keep the linter happy.
            raise RuntimeError("smart_retry fell through without returning") from last_exc

        _wrapped.__wrapped__ = fn  # type: ignore[attr-defined]
        _wrapped.__name__ = getattr(fn, "__name__", "smart_retry_wrapped")
        _wrapped.__doc__ = fn.__doc__
        return _wrapped

    return _decorator
