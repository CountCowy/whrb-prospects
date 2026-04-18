"""Boston Magazine "Best of Boston" — stubbed.

bostonmagazine.com returns 403 Forbidden to plain GETs. Revisit with
Playwright + stealth and a realistic fingerprint, or do a one-time manual
import of the annual winners CSV.
"""
from __future__ import annotations


def run_all() -> list[dict]:
    print("[best_of_boston] skipped — site blocks scrapers, needs rework")
    return []
