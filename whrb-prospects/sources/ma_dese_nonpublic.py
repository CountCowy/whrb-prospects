"""Stage T7 — MA DESE Non-Public School dataset.

Plan §9.4 — HTML scraping (rewrite from CSV-fetch 2026-05-01). Tags:
``sector:education``, ``cadence:admissions_window,term_driven``.

Source model: DESE's Profiles Search (``profiles.doe.mass.edu``) is an
ASP.NET WebForms app. There is no static URL or CSV export for the
Private Schools listing — the only way to get the roster is to:

1. Load the search page.
2. Select Organization Type = "Private Schools" (value=11).
3. POST the form (``__VIEWSTATE`` + selected option) — Playwright drives
   this transparently.
4. Scrape the rendered results.

Each result entry in the rendered HTML follows this textual pattern
(verified 2026-05-01):

  N. <Name> (<DOE-ID>)\tPrivate (Non-Public/Non-Special Ed) Schools
  Principal: <Name>
  <Street>, <City>, MA <ZIP>
  P: <Phone>  F: <Fax>\t<email>

  Grades Served: <list>

The parser uses regex on the joined text content (faster than walking
the WebForms-generated table soup) and emits one row per private
school. Filter applied: ZIP must be in :data:`config.WHRB_ZIPS`.

Backwards-compat CSV path retained for offline fixtures (the old
``schools`` slug).
"""
from __future__ import annotations

import re
from collections.abc import Iterator

from sources import _t7_common as common

SOURCE_KEY = "ma_dese_nonpublic"

# DESE Profiles Search — Private Schools query.
_LANDING_URL = "https://profiles.doe.mass.edu/search/search.aspx?leftNavId=11238"
_PRIVATE_SCHOOLS_ORGTYPE_VALUE = "11"

# Backwards-compat constant — the previous CSV-shaped guess. Kept as a
# documentation artefact only.
LIVE_URL = _LANDING_URL


# Block-level entry regex. Captures everything between "1." style numbers
# and the next number (or end-of-string). The "(?=...|$)" lookahead is
# greedy-safe.
_ENTRY_RE = re.compile(
    r"(?ms)^\s*(\d+)\.\s+(?P<name>[^\n(]+?)\s*\(\d{8}\)[\s\S]*?"
    r"(?=^\s*\d+\.\s+\S|\Z)"
)

# Sub-patterns within an entry block.
_ADDRESS_RE = re.compile(
    r"^\s*(?P<street>[^,\n]+),\s*(?P<city>[A-Za-z .'-]+),\s*MA\s+(?P<zip>\d{5})",
    re.M,
)
_PHONE_RE = re.compile(r"P:\s*([0-9]{3}[-.\s]?[0-9]{3}[-.\s]?[0-9]{4})")
_EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
_PRINCIPAL_RE = re.compile(r"Principal:\s*([^\n]+)", re.I)


def _fetch_results_text() -> str | None:
    """Use Playwright to drive the DESE WebForms search and return the
    rendered results as plain text. Returns None on any failure."""
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
                )
                page = ctx.new_page()
                page.goto(_LANDING_URL, wait_until="domcontentloaded", timeout=20000)
                page.wait_for_timeout(1500)
                # Select Private Schools and submit.
                page.select_option(
                    "#ctl00_ContentPlaceHolder1_orgtype",
                    _PRIVATE_SCHOOLS_ORGTYPE_VALUE,
                )
                page.wait_for_timeout(500)
                btn = page.query_selector('input[value*="Get Results"]')
                if btn is None:
                    btn = page.query_selector('input[type="submit"]')
                if btn is None:
                    return None
                btn.click()
                page.wait_for_load_state("domcontentloaded", timeout=20000)
                page.wait_for_timeout(2000)
                # Grab the visible text — the WebForms table renders one
                # nested <table> per result, and innerText flattens the
                # whole results region into the predictable block format
                # the regex above expects.
                main = page.query_selector("main") or page.query_selector("body")
                if main is None:
                    return None
                return main.inner_text()
            finally:
                browser.close()
    except Exception:
        return None


def _iter_entries(text: str) -> Iterator[dict]:
    for match in _ENTRY_RE.finditer(text):
        block = match.group(0)
        name = match.group("name").strip()
        if not name:
            continue

        addr_m = _ADDRESS_RE.search(block)
        phone_m = _PHONE_RE.search(block)
        email_m = _EMAIL_RE.search(block)
        princ_m = _PRINCIPAL_RE.search(block)

        if not addr_m:
            # Skip entries we can't tie to a ZIP — they fail the
            # WHRB-ZIP filter anyway and we need address fields for
            # the build_row schema.
            continue

        yield {
            "name": name,
            "street": addr_m.group("street").strip(),
            "city": addr_m.group("city").strip(),
            "zip": addr_m.group("zip"),
            "phone": phone_m.group(1).strip() if phone_m else None,
            "email": email_m.group(0) if email_m else None,
            "principal": princ_m.group(1).strip() if princ_m else None,
        }


def _emit_from_text(text: str) -> list[dict]:
    rows: list[dict] = []
    for rec in _iter_entries(text):
        if not common.acceptable_name(rec["name"]):
            continue
        if not common.in_signal_zone(rec["zip"]):
            continue

        full_address = ", ".join(
            s for s in (rec["street"], rec["city"]) if s
        ) or None
        notes = "ma_dese_nonpublic: non-public school"
        if rec["principal"]:
            notes += f" — Principal {rec['principal']}"

        rows.append(
            common.build_row(
                source_key=SOURCE_KEY,
                company_name=rec["name"],
                category="education/nonpublic_school",
                address=full_address,
                zip_code=rec["zip"],
                phone=rec["phone"],
                tier="A",
                sector="education",
                operating_model="institution",
                cadence=["admissions_window", "term_driven"],
                pipeline_notes=notes,
            )
        )
    return common.cap_rows(rows, cap=600)


def _emit_from_csv(text: str) -> list[dict]:
    """Backwards-compat CSV path used by offline fixtures."""
    rows: list[dict] = []
    for raw in common.parse_csv(text):
        name = raw.get("School Name") or raw.get("Name") or raw.get("school_name")
        zip_code = (raw.get("Zip") or raw.get("ZIP") or raw.get("zip") or "")[:5]
        address = raw.get("Address") or raw.get("Street Address")
        phone = raw.get("Phone") or raw.get("phone")
        website = raw.get("Website") or raw.get("URL") or raw.get("website")

        if not common.acceptable_name(name):
            continue
        if zip_code and not common.in_signal_zone(zip_code):
            continue

        rows.append(
            common.build_row(
                source_key=SOURCE_KEY,
                company_name=name,
                category="education/nonpublic_school",
                address=address,
                zip_code=zip_code,
                phone=phone,
                website=website,
                tier="A",
                sector="education",
                operating_model="institution",
                cadence=["admissions_window", "term_driven"],
                pipeline_notes="ma_dese_nonpublic: non-public school",
            )
        )
    return common.cap_rows(rows, cap=600)


def run_all() -> list[dict]:
    # 1. CSV fixture — preserves the existing C2 integrity test.
    text = common.read_fixture(SOURCE_KEY, "schools", ext="csv")
    if text is not None:
        return _emit_from_csv(text)

    # 2. Optional plaintext fixture (drop a real DESE results dump at
    # ``tests/fixtures/t7/ma_dese_nonpublic/schools.txt`` to exercise
    # the live-text path under offline mode).
    if common.offline_enabled():
        txt_path = common.fixture_path(SOURCE_KEY, "schools", ext="txt")
        if txt_path.exists():
            return _emit_from_text(txt_path.read_text(encoding="utf-8", errors="replace"))
        return []

    # 3. Live: drive Playwright + parse rendered text.
    rendered = _fetch_results_text()
    if not rendered:
        return []
    return _emit_from_text(rendered)
