"""Boston Magazine "Best of Boston" — stubbed.

bostonmagazine.com returns 403 Forbidden to plain GETs. Revisit with
Playwright + stealth and a realistic fingerprint, or do a one-time manual
import of the annual winners CSV.

Status (Stage 5.5): kept in the source registry for historical context but
excluded from :data:`config.ENABLED_SOURCES_DEFAULT`. Flip it back on via
``source_config.enabled = true`` (``/admin/sources``) once a working scraper
lands.
"""
from __future__ import annotations


def run_all() -> list[dict]:
    print("[best_of_boston] skipped — site blocks scrapers, needs rework")
    return []
