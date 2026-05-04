"""Regression tests for sources.osm_overpass HTTP behavior.

Run deebeff6 saw the entire ``osm`` source emit zero rows because
Overpass-API returned 406 Not Acceptable. Empirical probing showed the
server actively blocks bare ``python-requests/*`` and browser-style
User-Agents — only a descriptive identifying UA passes. These tests
lock in that contract by asserting the POST always carries our UA.
"""
from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

import pytest

from sources import osm_overpass


class _FakeResponse:
    def __init__(self, status: int = 200, payload: dict[str, Any] | None = None) -> None:
        self.status_code = status
        self.reason = "OK"
        self.url = osm_overpass.OVERPASS_URL
        self._payload = payload or {"elements": []}
        self.request = MagicMock(method="POST")

    def json(self) -> dict[str, Any]:
        return self._payload


def test_post_sets_descriptive_user_agent(monkeypatch: pytest.MonkeyPatch) -> None:
    """Overpass blocks generic UAs with 406; we must send a descriptive one."""
    captured: dict[str, Any] = {}

    def fake_post(url, **kwargs):
        captured["url"] = url
        captured["headers"] = kwargs.get("headers")
        captured["data"] = kwargs.get("data")
        return _FakeResponse(status=200)

    monkeypatch.setattr(osm_overpass.requests, "post", fake_post)

    osm_overpass._post("[out:json][timeout:1];node(0,0,0.001,0.001);out;")

    assert captured["url"] == osm_overpass.OVERPASS_URL
    assert captured["headers"] is not None
    ua = captured["headers"]["User-Agent"]
    # Descriptive UA: includes our project identifier and a contact.
    # The empirical 406 test showed bare `python-requests/*` and
    # browser-style UAs are rejected — our UA must NOT match either.
    assert "WHRBProspectPipeline" in ua
    assert "whrb.org" in ua
    assert not ua.startswith("python-requests")
    assert not ua.startswith("Mozilla/")
