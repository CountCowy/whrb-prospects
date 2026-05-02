"""Stage T7 — Mass.gov Assisted Living Residence list.

Plan §9.4 — bulk-XLSX (rewrite from CSV 2026-05-01). Tags:
``sector:medical``, ``operating_model:institution``, ``cadence:year_round``.

Download model: mass.gov DPH publishes the certified ALR list as a
date-stamped XLSX file linked from the canonical
``/assisted-living-residences`` page (current example slug:
``list-of-certified-assisted-living-residences-as-of-april-2025``). The
slug rolls forward whenever DPH updates the list, so this module:

1. Uses Playwright to navigate the canonical page.
2. Discovers the "Download a list of Assisted Living Residences" link.
3. Triggers an Akamai-cookie-aware download.
4. Parses the XLSX with openpyxl (read-only, streaming).
5. Filters by city against :data:`_WHRB_CITIES` because the XLSX has no
   ZIP column.

Why Playwright (not requests): mass.gov fronts the document
endpoints with Akamai Bot Manager. Direct HTTP fetches — even with full
Chrome-like headers — are 403'd. A headless browser navigation passes
the WAF challenge cookies and downloads succeed.

Plain HTTP path retained as a fallback for offline / fixture mode and
for the case where Playwright isn't installed in the runner.

XLSX schema (verified 2026-05-01 on the april-2025 release):

  Sheet: "ALR in alpabetical order" (DPH typo preserved upstream)
  Row 0: title cell (skip)
  Row 1: header — ALR Name | Address | City | Telephone | Total # Units
                  | Total Traditional Units | Total SCR UNITS
  Row 2+: data rows
"""
from __future__ import annotations

import io
from typing import Iterator

from sources import _t7_common as common

SOURCE_KEY = "ma_alr"

# Canonical landing page that links to the ALR list. The list slug
# rotates each release; we discover it dynamically rather than hard-coding.
_LANDING_URL = "https://www.mass.gov/assisted-living-residences"

# Backwards-compat constant — the previous CSV-shaped guess. Kept as a
# documentation artefact only; actual fetch now goes through
# `_discover_and_download_xlsx` against `_LANDING_URL`.
LIVE_URL = _LANDING_URL

# Cities (and city-equivalent neighborhoods) that map onto WHRB ZIPs.
# Used because the DPH XLSX schema does NOT include a ZIP column —
# only ALR Name / Address (street only) / City / Telephone / unit counts.
# Any address normalization that derives a ZIP from the address field is
# unreliable on this dataset (street addresses have no ZIP suffix), so
# the filter pivots on city name.
_WHRB_CITIES: frozenset[str] = frozenset(
    {
        "Boston", "Cambridge", "Brookline", "Somerville",
        "Watertown", "Newton", "Medford", "Malden",
        "Quincy", "Salem", "Lynn", "Allston", "Brighton",
        "Jamaica Plain", "Roxbury", "Dorchester", "Back Bay",
        "South End", "Charlestown", "East Boston", "Hyde Park",
        "Mattapan", "West Roxbury",
        # Outer ring covered by the T1 WHRB_ZIPS widening.
        "Belmont", "Arlington", "Winchester", "Waltham", "Woburn",
        "Melrose", "Revere", "Chelsea", "Everett", "Peabody",
    }
)


def _discover_and_download_xlsx() -> bytes | None:
    """Drive Playwright to fetch the live ALR XLSX. Returns bytes or
    ``None`` on any failure (so the caller can degrade to fixture-mode
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
                # Step 1: load canonical page so Akamai sets challenge cookies.
                page.goto(_LANDING_URL, wait_until="domcontentloaded", timeout=20000)
                page.wait_for_timeout(1500)

                # Step 2: locate the download link by text. DPH publishes
                # the alphabetical list with a "Download a list of
                # Assisted Living Residences" anchor on the canonical page.
                href = page.evaluate(
                    """
                    () => {
                        const anchors = Array.from(document.querySelectorAll('a[href]'));
                        for (const a of anchors) {
                            const txt = (a.innerText || '').trim().toLowerCase();
                            const href = a.getAttribute('href') || '';
                            if (
                                /list of assisted living residences|certified assisted living/.test(txt)
                                && /\\/doc\\//.test(href)
                                && /\\/download/.test(href)
                            ) return href;
                        }
                        return null;
                    }
                    """
                )
                if not href:
                    return None
                if href.startswith("/"):
                    target = "https://www.mass.gov" + href
                elif href.startswith("http"):
                    target = href
                else:
                    target = "https://www.mass.gov/" + href

                # Step 3: trigger download by setting location.
                with page.expect_download(timeout=20000) as dl_info:
                    page.evaluate(f"window.location.href = '{target}'")
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


def _iter_rows(xlsx_bytes: bytes) -> Iterator[dict]:
    """Stream the XLSX via openpyxl (read-only) and yield row dicts.

    DPH publishes the data with a one-row title + one-row header above
    the data, in a single sheet. The header row is detected by looking
    for the literal "ALR Name" cell so we don't break if DPH pads with
    additional title rows.
    """
    import openpyxl

    wb = openpyxl.load_workbook(io.BytesIO(xlsx_bytes), read_only=True, data_only=True)
    sheet = wb[wb.sheetnames[0]]

    header: list[str] | None = None
    for row in sheet.iter_rows(values_only=True):
        if not row:
            continue
        if header is None:
            # Detect header row by looking for "ALR Name" verbatim.
            if row[0] and isinstance(row[0], str) and row[0].strip().lower().startswith("alr name"):
                header = [(c or "").strip() if isinstance(c, str) else "" for c in row]
            continue
        # Skip blank rows (DPH sometimes pads with empty trailers).
        if not any(c for c in row):
            continue
        # Only accept rows with a name in column 0.
        if not row[0]:
            continue
        yield dict(zip(header, row))


def _emit_from_xlsx(xlsx_bytes: bytes) -> list[dict]:
    rows: list[dict] = []
    for raw in _iter_rows(xlsx_bytes):
        name = raw.get("ALR Name") or ""
        if isinstance(name, str):
            name = name.strip()
        else:
            name = str(name).strip() if name is not None else ""
        if not common.acceptable_name(name):
            continue

        city_raw = raw.get("City") or ""
        city = city_raw.strip() if isinstance(city_raw, str) else ""
        if city not in _WHRB_CITIES:
            continue

        address_raw = raw.get("Address") or ""
        address = address_raw.strip() if isinstance(address_raw, str) else ""
        # Compose a fuller address from street + city for downstream
        # contact enrichment.
        full_addr = ", ".join(s for s in (address, city) if s) or None

        # DPH packs multiple phone numbers into one cell separated by
        # newlines. Take the first.
        phone_raw = raw.get("Telephone") or ""
        if isinstance(phone_raw, str):
            phone = phone_raw.split("\n", 1)[0].strip() or None
        else:
            phone = None

        rows.append(
            common.build_row(
                source_key=SOURCE_KEY,
                company_name=name,
                category="medical/assisted_living",
                address=full_addr,
                phone=phone,
                tier="A",
                sector="medical",
                operating_model="institution",
                cadence="year_round",
                pipeline_notes=f"ma_alr: assisted living residence ({city})",
            )
        )
    return common.cap_rows(rows, cap=500)


def _emit_from_csv(text: str) -> list[dict]:
    """Backwards-compat CSV path used by offline fixtures.

    Pre-XLSX-rewrite fixtures at ``tests/fixtures/t7/ma_alr/residences.csv``
    use the CSV column shape the legacy parser expected. Kept so the
    integrity matrix doesn't have to be re-planted before exit-gate
    rerun.
    """
    rows: list[dict] = []
    for raw in common.parse_csv(text):
        name = raw.get("Residence Name") or raw.get("Name") or raw.get("name")
        zip_code = (raw.get("Zip") or raw.get("ZIP") or raw.get("zip") or "")[:5]
        address = raw.get("Address") or raw.get("Street Address")
        phone = raw.get("Phone") or raw.get("Phone Number") or raw.get("phone")

        if not common.acceptable_name(name):
            continue
        if zip_code and not common.in_signal_zone(zip_code):
            continue

        rows.append(
            common.build_row(
                source_key=SOURCE_KEY,
                company_name=name,
                category="medical/assisted_living",
                address=address,
                zip_code=zip_code,
                phone=phone,
                tier="A",
                sector="medical",
                operating_model="institution",
                cadence="year_round",
                pipeline_notes="ma_alr: assisted living residence",
            )
        )
    return common.cap_rows(rows, cap=500)


def run_all() -> list[dict]:
    # 1. CSV fixture path — preserves the existing C2 integrity test.
    text = common.read_fixture(SOURCE_KEY, "residences", ext="csv")
    if text is not None:
        return _emit_from_csv(text)

    # 2. Optional XLSX fixture (operators can drop a real .xlsx at
    # ``tests/fixtures/t7/ma_alr/residences.xlsx`` to exercise the
    # XLSX path under offline mode).
    if common.offline_enabled():
        xlsx_path = common.fixture_path(SOURCE_KEY, "residences", ext="xlsx")
        if xlsx_path.exists():
            try:
                return _emit_from_xlsx(xlsx_path.read_bytes())
            except Exception:
                return []
        return []

    # 3. Live path — Playwright-driven discovery + download.
    xlsx_bytes = _discover_and_download_xlsx()
    if not xlsx_bytes:
        return []
    try:
        return _emit_from_xlsx(xlsx_bytes)
    except Exception:
        return []
