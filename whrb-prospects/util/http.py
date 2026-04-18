"""Shared HTTP helpers: smart retry + status classifier.

Retries should only happen for transient failures (5xx, 429, network errors).
4xx responses are permanent and must NOT be retried.
"""
from __future__ import annotations

import requests
from tenacity import (
    retry,
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


def raise_for_smart_status(response: requests.Response) -> None:
    """Replacement for response.raise_for_status() that classifies errors."""
    code = response.status_code
    if code == 429 or (500 <= code < 600):
        raise RetryableHTTPError(f"{code} {response.reason} {response.url}")
    if 400 <= code < 500:
        raise NonRetryableHTTPError(f"{code} {response.reason} {response.url}")


def smart_retry(max_attempts: int = 3, wait_min: int = 2, wait_max: int = 20):
    """Decorator: retries only on transient failures, bounded backoff."""
    return retry(
        stop=stop_after_attempt(max_attempts),
        wait=wait_exponential(min=wait_min, max=wait_max),
        retry=retry_if_exception_type(RETRYABLE_EXCEPTIONS),
        reraise=True,
    )
