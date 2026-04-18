"""Small row-field normalizers used by enrichers that read raw source data.

Defensive against drift — some sources (notably Socrata URL-type fields)
return dicts instead of plain strings for `website`. This helper unwraps
those so downstream `urlparse(...)` calls never see a non-string.
"""
from __future__ import annotations


def normalize_website(raw) -> str | None:
    """Return a string URL, or None. Accepts str, dict (Socrata URL type),
    or anything else (returns None)."""
    if not raw:
        return None
    if isinstance(raw, dict):
        raw = raw.get("url") or raw.get("href")
    if not isinstance(raw, str):
        return None
    raw = raw.strip()
    return raw or None
