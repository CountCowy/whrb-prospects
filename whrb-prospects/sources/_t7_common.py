"""Shared helpers for the T7 source batch.

T7 sources are mostly bulk-CSV downloads from open-data portals plus a
handful of static-HTML directories. This module collects the plumbing
each module would otherwise re-implement: fixture-mode loading, polite
HTTP, common ZIP filters, name-normalisation guards, and the per-source
``run_all`` boilerplate.

Public API:

* :data:`USER_AGENT`, :data:`HTTP_TIMEOUT_SECONDS`, :data:`RATE_LIMIT_SECONDS`
  — same posture as the T6 ``_sponsor_pages_common`` module so the
  destinations only see one WHRB UA.
* :data:`FIXTURE_ROOT` — ``tests/fixtures/t7/<source_key>/<slug>.<ext>``.
* :func:`read_fixture` — gated by ``WHRB_T7_OFFLINE=1`` env var; mirrors
  T6 helper.
* :func:`offline_enabled` — bool form of the env var check.
* :func:`http_get` — UA-stamped, smart-retry-wrapped GET.
* :func:`per_host_sleep` — block until per-host rate limit elapses.
* :func:`build_row` — assembles the ``{company_name, source, ...,
  tags}`` dict that T7 sources emit. Saves every module from
  re-implementing the same key shuffle.
* :func:`acceptable_name` — name-shape guard.
* :func:`cap_rows` — enforces a per-source row cap (T7 plan §9.5 hints
  at caps for SEC ADV / MCC / etc.).

Cache TTLs:

* :data:`CACHE_TTL_BULK_CSV_SECONDS` — 7 days for SEC + SBA quarterly
  datasets. (Per plan §9.5.) Other T7 sources use the default 24h cache
  via ``requests-cache``.
"""
from __future__ import annotations

import csv
import io
import os
import time
import urllib.parse
from collections.abc import Iterable
from pathlib import Path
from typing import Any

import requests

from enrich.dedupe import _norm_name
from util.http import raise_for_smart_status, smart_retry
from util.tags import affiliation_for_zip, build_tag_set

USER_AGENT = (
    "WHRBProspectPipeline/1.0 "
    "(+https://www.whrb.org/sales; sales@whrb.org)"
)

RATE_LIMIT_SECONDS = 5
HTTP_TIMEOUT_SECONDS = 30

CACHE_TTL_BULK_CSV_SECONDS = 7 * 24 * 60 * 60  # 7 days

FIXTURE_ROOT = (
    Path(__file__).resolve().parent.parent / "tests" / "fixtures" / "t7"
)

# Per-source row cap defaults. Specific modules can override.
DEFAULT_MAX_ROWS = 2000


# ----------------------------------------------------------------------------
# Offline-fixture mode
# ----------------------------------------------------------------------------


def offline_enabled() -> bool:
    raw = os.environ.get("WHRB_T7_OFFLINE", "").strip().lower()
    return raw in {"1", "true", "yes"}


def read_fixture(source_key: str, slug: str, ext: str = "csv") -> str | None:
    """Return fixture content for ``tests/fixtures/t7/<source_key>/<slug>.<ext>``.

    Returns ``None`` when offline mode is off OR the fixture is missing.
    Default extension is ``csv``; HTML/JSON sources pass ``ext='html'``
    or ``ext='json'``.
    """
    if not offline_enabled():
        return None
    path = FIXTURE_ROOT / source_key / f"{slug}.{ext}"
    if not path.exists():
        return None
    return path.read_text(encoding="utf-8", errors="replace")


def fixture_path(source_key: str, slug: str, ext: str = "csv") -> Path:
    """Compute the fixture path (without checking existence)."""
    return FIXTURE_ROOT / source_key / f"{slug}.{ext}"


# ----------------------------------------------------------------------------
# Per-host rate limiting (mirrors T6 helper)
# ----------------------------------------------------------------------------

_LAST_FETCH: dict[str, float] = {}


def per_host_sleep(url: str, *, seconds: float = RATE_LIMIT_SECONDS) -> None:
    try:
        host = urllib.parse.urlparse(url).netloc.lower()
    except ValueError:
        return
    if not host:
        return
    last = _LAST_FETCH.get(host, 0.0)
    elapsed = time.time() - last
    if elapsed < seconds:
        time.sleep(seconds - elapsed)
    _LAST_FETCH[host] = time.time()


def reset_rate_limit_state() -> None:
    _LAST_FETCH.clear()


# ----------------------------------------------------------------------------
# HTTP
# ----------------------------------------------------------------------------


@smart_retry()
def http_get(url: str) -> str:
    """UA-stamped, smart-retry-wrapped GET. Returns response text."""
    r = requests.get(
        url,
        headers={"User-Agent": USER_AGENT},
        timeout=HTTP_TIMEOUT_SECONDS,
    )
    raise_for_smart_status(r)
    return r.text


# ----------------------------------------------------------------------------
# Name guards
# ----------------------------------------------------------------------------

_GENERIC_BLOCKLIST: frozenset[str] = frozenset(
    {
        "n/a", "na", "none", "null", "tbd", "test", "unknown",
        "see above", "same as above", "x", "xx", "xxx",
    }
)


def acceptable_name(
    name: str | None,
    *,
    extra_blocklist: Iterable[str] = (),
    min_len: int = 3,
    max_len: int = 120,
) -> bool:
    if not name:
        return False
    s = name.strip()
    if len(s) < min_len or len(s) > max_len:
        return False
    norm = _norm_name(s)
    if not norm:
        return False
    if norm in _GENERIC_BLOCKLIST:
        return False
    extra = frozenset(extra_blocklist)
    if norm in extra:
        return False
    return True


def cap_rows(rows: list[dict], cap: int = DEFAULT_MAX_ROWS) -> list[dict]:
    if cap is None or cap <= 0 or len(rows) <= cap:
        return rows
    return rows[:cap]


# ----------------------------------------------------------------------------
# Row assembly
# ----------------------------------------------------------------------------


def build_row(
    *,
    source_key: str,
    company_name: str,
    category: str | None = None,
    address: str | None = None,
    zip_code: str | None = None,
    phone: str | None = None,
    website: str | None = None,
    tier: str = "C",
    sector: str | list[str] | None = None,
    operating_model: str | list[str] | None = None,
    genre: str | list[str] | None = None,
    affiliation: str | list[str] | None = None,
    cadence: str | list[str] | None = None,
    history: str | list[str] | None = None,
    compliance: str | list[str] | None = None,
    pipeline_notes: str | None = None,
    auto_affiliation_from_zip: bool = True,
) -> dict[str, Any]:
    """Assemble a dict suitable for emission into the pipeline.

    ``auto_affiliation_from_zip`` (default True) appends a ZIP-derived
    affiliation to the `affiliation` axis if one isn't already present.
    """
    if auto_affiliation_from_zip and zip_code:
        zip_aff = affiliation_for_zip(zip_code)
        if zip_aff:
            if affiliation is None:
                affiliation = [zip_aff]
            elif isinstance(affiliation, str):
                if affiliation != zip_aff:
                    affiliation = [affiliation, zip_aff]
            else:
                if zip_aff not in affiliation:
                    affiliation = [*list(affiliation), zip_aff]

    tags = build_tag_set(
        sector=sector,
        operating_model=operating_model,
        genre=genre,
        affiliation=affiliation,
        cadence=cadence,
        history=history,
        compliance=compliance,
        source=source_key,
    )

    row: dict[str, Any] = {
        "company_name": company_name,
        "source": source_key,
        "category": category or "",
        "tier": tier,
        "tags": tags,
    }
    if address:
        row["address"] = address
    if zip_code:
        row["zip"] = str(zip_code).strip()[:5]
    if phone:
        row["phone"] = phone
    if website:
        row["website"] = website
    if pipeline_notes:
        row["pipeline_notes"] = pipeline_notes
    return row


# ----------------------------------------------------------------------------
# CSV parsing helper
# ----------------------------------------------------------------------------


def parse_csv(text: str) -> list[dict[str, str]]:
    """DictReader wrapper that handles BOM + tolerates blank rows.

    Returns a list of dicts keyed on the header row; missing values are
    coerced to empty strings.
    """
    if not text:
        return []
    if text.startswith("﻿"):
        text = text.lstrip("﻿")
    buf = io.StringIO(text)
    reader = csv.DictReader(buf)
    out: list[dict[str, str]] = []
    for row in reader:
        if not row:
            continue
        clean = {
            (k.strip() if k else ""): (v.strip() if isinstance(v, str) else (v or ""))
            for k, v in row.items()
            if k is not None
        }
        if not any(clean.values()):
            continue
        out.append(clean)
    return out


# ----------------------------------------------------------------------------
# ZIP filter
# ----------------------------------------------------------------------------


def in_signal_zone(zip_code: str | None) -> bool:
    """Return True if a ZIP falls within WHRB's signal area or its near
    fringe. Used to filter bulk MA-wide datasets to relevant rows.
    """
    from config import WHRB_ZIPS

    if not zip_code:
        return False
    z = str(zip_code).strip()[:5]
    return z in WHRB_ZIPS
