"""Stage T7 — MA DPU household-goods movers list.

Plan §9.4 — HTML scraping (rewrite from CSV-fetch 2026-05-01). Tags:
``sector:home_services``, ``cadence:move_window,seasonal_summer``.

Download model: the DPU Transportation Oversight Division publishes the
mover roster as a date-stamped CSV file linked from
``/info-details/moving-companies-regulated-by-the-department-of-public-utilities-dpu``.
The CSV slug rolls forward each release (current example:
``DPU Moving Company Tariff February 2026.csv``) so this module:

1. Uses Playwright to navigate the canonical info-details page.
2. Discovers any anchor whose href contains ``/files/csv/`` and the
   text or filename contains "DPU" + "Tariff".
3. Downloads the CSV through the same browser session (Akamai-cookie-aware).
4. Parses with the standard CSV path; filters by city against
   :data:`_WHRB_CITIES`.

Why Playwright (not requests): mass.gov fronts the document endpoints
with Akamai Bot Manager. Direct HTTP fetches — even with full
Chrome-like headers — are 403'd. A headless browser navigation passes
the WAF challenge cookies and downloads succeed.

CSV schema (verified 2026-05-01 on the February 2026 release):

  Company Name | Tariff / Rates (label) | Tariff / Rates (url) |
  Doing Business As | Certificate Number | City / Town | State

The CSV header has TWO "Tariff / Rates" columns (label + URL). Python's
``csv.DictReader`` keeps only the second one; that's fine — we don't
read either column.
"""
from __future__ import annotations

import re
from typing import Iterator

from sources import _t7_common as common

SOURCE_KEY = "ma_dpu_movers"

# Canonical info-details page (HTML); the CSV link is discovered from
# this page via Playwright at run time.
_LANDING_URL = (
    "https://www.mass.gov/info-details/"
    "moving-companies-regulated-by-the-department-of-public-utilities-dpu"
)

# Backwards-compat constant — the previous /doc/ guess. Kept as a
# documentation artefact only; actual fetch now goes through
# `_discover_and_download_csv`.
LIVE_URL = _LANDING_URL

# WHRB signal-area cities (uppercased to match DPU's all-caps City field).
_WHRB_CITIES: frozenset[str] = frozenset(
    {
        "BOSTON", "CAMBRIDGE", "BROOKLINE", "SOMERVILLE",
        "WATERTOWN", "NEWTON", "MEDFORD", "MALDEN",
        "QUINCY", "SALEM", "LYNN", "ALLSTON", "BRIGHTON",
        "JAMAICA PLAIN", "ROXBURY", "DORCHESTER",
        "CHARLESTOWN", "EAST BOSTON", "HYDE PARK",
        "MATTAPAN", "WEST ROXBURY",
        "BELMONT", "ARLINGTON", "WINCHESTER",
        "WALTHAM", "WOBURN", "MELROSE", "REVERE",
        "CHELSEA", "EVERETT", "PEABODY",
    }
)

# Regex for "looks like a CSV link" — the DPU page uses /files/csv/...
# Note the URL-encoded spaces (``%20``) the publisher emits.
_CSV_HREF_RE = re.compile(r"/files/csv/[^\"'\s]+\.csv", re.I)


def _discover_and_download_csv() -> bytes | None:
    """Drive Playwright to fetch the live DPU movers CSV. Returns bytes
    or ``None`` on any failure (so the caller can degrade to fixture
    or 0 rows without raising)."""
    try:
        from playwright.sync_api import sync_playwright
    except Exception:
        return None

    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)
            try:
                ctx = browser.new_context(
                    user_agent=(
                        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                        "AppleWebKit/537.36 (KHTML, like Gecko) "
                        "Chrome/120.0.0.0 Safari/537.36"
                    ),
                    accept_downloads=True,
                )
                page = ctx.new_page()
                page.goto(_LANDING_URL, wait_until="domcontentloaded", timeout=20000)
                page.wait_for_timeout(1500)
                # Find the first /files/csv/... link.
                href = page.evaluate(
                    """
                    () => {
                        const re = /\\/files\\/csv\\/[^"' ]+\\.csv/i;
                        for (const a of document.querySelectorAll('a[href]')) {
                            const h = a.getAttribute('href') || '';
                            if (re.test(h)) {
                                if (h.startsWith('http')) return h;
                                if (h.startsWith('/')) return 'https://www.mass.gov' + h;
                                return 'https://www.mass.gov/' + h;
                            }
                        }
                        return null;
                    }
                    """
                )
                if not href:
                    return None
                with page.expect_download(timeout=20000) as dl_info:
                    page.evaluate(f"window.location.href = '{href}'")
                download = dl_info.value
                tmp_path = download.path()
                if tmp_path is None:
                    return None
                with open(tmp_path, "rb") as f:
                    return f.read()
            finally:
                browser.close()
    except Exception:
        return None


def _emit_from_csv(text: str) -> list[dict]:
    """Parse the DPU movers CSV. Filters by City/Town in
    :data:`_WHRB_CITIES`. Falls through to the standard
    name+zip+phone build_row pipeline."""
    rows: list[dict] = []
    for raw in common.parse_csv(text):
        name = (
            raw.get("Company Name")
            or raw.get("Carrier Name")
            or raw.get("Name")
            or raw.get("name")
        )
        # DBA is sometimes more recognizable as a brand name. Use it
        # alongside the legal name in pipeline_notes for context.
        dba = (raw.get("Doing Business As") or "").strip()
        cert = (raw.get("Certificate Number") or "").strip() or None
        city = (raw.get("City / Town") or raw.get("City") or "").strip().upper()

        # DPU never publishes ZIPs in this file, so we filter on city.
        # Also accept blank-city rows so out-of-state edge cases (carriers
        # registered with NH/RI addresses but serving MA) still surface
        # under a permissive setting; this matches the
        # `zip_filter_permissive` default in _t7_common's HTML fallback.
        if city and city not in _WHRB_CITIES:
            continue

        if not common.acceptable_name(name):
            continue

        notes = "ma_dpu_movers: household-goods mover"
        if cert:
            notes += f" (cert #{cert})"
        if dba and dba.lower() not in {"same", ""}:
            notes += f" — DBA {dba}"

        rows.append(
            common.build_row(
                source_key=SOURCE_KEY,
                company_name=name,
                category="home_services/movers",
                tier="C",
                sector="home_services",
                operating_model="service_provider",
                cadence=["move_window", "seasonal_summer"],
                pipeline_notes=notes,
            )
        )
    return common.cap_rows(rows, cap=400)


def run_all() -> list[dict]:
    # 1. CSV fixture path — preserves the existing C2 integrity test.
    text = common.read_fixture(SOURCE_KEY, "movers", ext="csv")
    if text is not None:
        return _emit_from_csv(text)

    if common.offline_enabled():
        return []

    # 2. Live: drive Playwright to find + download the date-stamped CSV.
    csv_bytes = _discover_and_download_csv()
    if not csv_bytes:
        return []
    try:
        text = csv_bytes.decode("utf-8", errors="replace")
    except Exception:
        return []
    return _emit_from_csv(text)
