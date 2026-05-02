"""Stage T7 — New England Foundation for the Arts grantee list.

Plan §9.4 — HTML scraping (rewrite from CSV-fetch 2026-05-01). Tags:
``affiliation:new_england_regional`` + sector. Rows here often overlap
with MCC grantees from MA; T7's manifest flags ``ma_cultural_council``
as the dedupe partner.

Source model: NEFA's ``/grant-recipients`` is a Drupal Views directory.
Each entry renders as a ``.views-row`` carrying:

  - the grant program name (``.field--name-field-grant-or-program``)
  - the grantee node title (``.field--name-node-title h2 a``)
  - sometimes an "ARTIST: ..." line under the title

There is no state/city field exposed on the listing teaser, so we cannot
filter on ZIP. Per the legacy module's design, every NEFA grantee gets
the ``affiliation:new_england_regional`` tag and a default Tier C
unless the dedupe partner (``ma_cultural_council``) merges them up.

Pagination: NEFA caps ``items_per_page=120``. We walk forward until we
either run out of pages or hit our internal page-count safety cap
(:data:`_MAX_PAGES`). At 5 pages x 120 = 600 grantees, that gives us
enough surface area to catch every MA-domiciled grantee whose name
matches an MCC-funded org without overwhelming the dedupe pipeline.

Note: NEFA's listing mixes organizational grantees (e.g. "ArtsBoston",
"Boston Ballet") with individual artist grantees (e.g. "Alexander
Davis"). Both surface as prospects under v1; the dedupe pass against
ma_cultural_council will collapse the org-shaped duplicates and any
single-name artist that doesn't have a matching prospect drops out as
unreachable when contact-enrichment later finds no website.
"""
from __future__ import annotations

import re
from collections.abc import Iterable

from sources import _t7_common as common

SOURCE_KEY = "nefa_grantees"

_LANDING_BASE = "https://www.nefa.org/grant-recipients"

# Backwards-compat constant — kept as documentation artefact.
LIVE_URL = _LANDING_BASE

_MAX_PAGES = 5  # 5 x 120 = 600 grantee rows max.
_ITEMS_PER_PAGE = 120

# Pattern for program-only "ARTIST:" lines so we can split them out of
# the grantee name when the listing teaser wraps the artist context.
_ARTIST_LINE_RE = re.compile(r"^ARTIST:\s*", re.I)


def _fetch_grantees() -> list[tuple[str, str]] | None:
    """Walk NEFA pagination and return ``(grant_program, grantee_name)``
    tuples. Returns ``None`` on any failure."""
    try:
        from playwright.sync_api import sync_playwright
    except Exception:
        return None

    out: list[tuple[str, str]] = []
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
                for page_idx in range(_MAX_PAGES):
                    url = (
                        f"{_LANDING_BASE}?items_per_page={_ITEMS_PER_PAGE}"
                        + (f"&page={page_idx}" if page_idx else "")
                    )
                    try:
                        page.goto(url, wait_until="networkidle", timeout=30000)
                        page.wait_for_timeout(1500)
                    except Exception:
                        break
                    rows = page.evaluate(
                        """
                        () => {
                            const out = [];
                            for (const r of document.querySelectorAll('.views-row')) {
                                const program = r.querySelector('.field--name-field-grant-or-program');
                                const title = r.querySelector('.field--name-node-title a, h2 a');
                                if (title) {
                                    out.push({
                                        program: program ? program.innerText.trim() : '',
                                        name: title.innerText.trim(),
                                    });
                                }
                            }
                            return out;
                        }
                        """
                    )
                    if not rows:
                        break
                    for r in rows:
                        out.append((r.get("program", ""), r.get("name", "")))
                return out
            finally:
                browser.close()
    except Exception:
        return None


def _emit_from_records(records: Iterable[tuple[str, str]]) -> list[dict]:
    rows: list[dict] = []
    seen: set[str] = set()
    for program, name in records:
        if not name:
            continue
        # Strip leading "ARTIST: " if present (the listing sometimes
        # collapses artist context into the title).
        clean = _ARTIST_LINE_RE.sub("", name).strip()
        if not common.acceptable_name(clean):
            continue
        # Dedup by case-insensitive name within this run.
        key = clean.lower()
        if key in seen:
            continue
        seen.add(key)

        notes = "nefa_grantees: NE regional grantee"
        if program:
            notes += f" ({program})"

        rows.append(
            common.build_row(
                source_key=SOURCE_KEY,
                company_name=clean,
                category="arts/nefa_grantee",
                tier="C",  # Default; dedupe with MCC may upgrade to A.
                sector=["arts", "nonprofit"],
                operating_model="institution",
                affiliation=["new_england_regional"],
                cadence="year_round",
                pipeline_notes=notes,
                # Don't auto-attach a ZIP-derived affiliation — there
                # is no ZIP on these rows.
                auto_affiliation_from_zip=False,
            )
        )
    return common.cap_rows(rows, cap=600)


def _emit_from_csv(text: str) -> list[dict]:
    """Backwards-compat CSV path used by offline fixtures."""
    rows: list[dict] = []
    for raw in common.parse_csv(text):
        name = (
            raw.get("Grantee")
            or raw.get("Organization")
            or raw.get("Name")
            or raw.get("name")
        )
        zip_code = (raw.get("Zip") or raw.get("ZIP") or raw.get("zip") or "")[:5]
        state = (raw.get("State") or raw.get("state") or "").strip().upper()
        discipline = raw.get("Discipline") or raw.get("Category") or "arts"

        if not common.acceptable_name(name):
            continue
        in_zone = common.in_signal_zone(zip_code)
        affiliation: list[str] = ["new_england_regional"]
        rows.append(
            common.build_row(
                source_key=SOURCE_KEY,
                company_name=name,
                category=f"arts/{discipline.lower().replace(' ', '_')}",
                zip_code=zip_code,
                tier="B" if in_zone else "C",
                sector=["arts", "nonprofit"],
                operating_model="institution",
                affiliation=affiliation,
                cadence="year_round",
                pipeline_notes=f"nefa_grantees: {state or 'NE'} regional grantee",
                auto_affiliation_from_zip=in_zone,
            )
        )
    return common.cap_rows(rows, cap=600)


def run_all() -> list[dict]:
    text = common.read_fixture(SOURCE_KEY, "grantees", ext="csv")
    if text is not None:
        return _emit_from_csv(text)

    if common.offline_enabled():
        return []

    records = _fetch_grantees()
    if not records:
        return []
    return _emit_from_records(records)
