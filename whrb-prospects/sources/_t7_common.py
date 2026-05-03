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
import re
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

    When offline mode is *on* and the fixture is missing, emits a
    ``t7_fixture_missing`` warning to ``event_log`` so test-environment
    misconfigurations surface rather than silently emitting 0 rows.
    """
    if not offline_enabled():
        return None
    path = FIXTURE_ROOT / source_key / f"{slug}.{ext}"
    if not path.exists():
        # Best-effort warn; never let event_log import or write failures
        # break a source module.
        try:
            from util import event_log

            event_log.warn(
                "t7_fixture_missing",
                f"offline mode enabled but fixture missing: {source_key}/{slug}.{ext}",
                context={
                    "source": source_key,
                    "slug": slug,
                    "ext": ext,
                    "path": str(path),
                },
            )
        except Exception:
            pass
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
        # Use the canonical CSV column name. Earlier T7 batches wrote
        # ``row["phone"]`` here, which the CSV writer (CSV_COLUMNS in
        # pipeline.py) and ``db.supabase_sync.SCRAPED_FIELDS`` both
        # silently dropped — every T7 source's phone field was lost on
        # write. Fixed during the post-T7 tech-debt sweep.
        row["company_phone"] = phone
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


# ----------------------------------------------------------------------------
# Playwright-driven HTML fetch (for JS-rendered directories)
# ----------------------------------------------------------------------------
#
# Many trade-association directories (Noviams / WildApricot / WordPress
# member-directory plugins) ship as a static template that loads the
# actual member list via XHR after page hydration. The cheap requests-
# based ``http_get`` returns 200 + HTML but the directory rows never
# appear in the body. ``fetch_html_via_playwright`` does a full
# headless-browser navigation, waits for ``networkidle`` plus a short
# settle delay, and returns the post-render DOM.
#
# Returns ``None`` on any failure (Playwright not installed, host
# unreachable, navigation timeout) so the caller can degrade to the
# static path or 0 rows without raising.


def fetch_html_via_playwright(
    url: str,
    *,
    wait_until: str = "networkidle",
    timeout_ms: int = 30000,
    settle_ms: int = 2500,
) -> str | None:
    """Render ``url`` in a headless Chromium and return the post-load
    DOM as HTML. Used by trade-association scrapers whose listings are
    JS-driven (the static HTTP path returns an empty template)."""
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
                try:
                    page.goto(url, wait_until=wait_until, timeout=timeout_ms)
                except Exception:
                    # Some hosts never reach networkidle (analytics
                    # heartbeats, etc.). Fall back to domcontentloaded
                    # and accept the partially-hydrated DOM.
                    try:
                        page.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)
                    except Exception:
                        return None
                if settle_ms:
                    page.wait_for_timeout(settle_ms)
                return page.content()
            finally:
                browser.close()
    except Exception:
        return None


# ----------------------------------------------------------------------------
# Generic HTML directory fallback parser
# ----------------------------------------------------------------------------
#
# Each T7 HTML scraper has a per-source ``_emit_from_html`` whose CSS
# selectors are necessarily speculative pre-live-validation (the sandbox
# couldn't reach the live sites at plant time). The fallback parser below
# kicks in when those per-source selectors yield zero rows on real HTML —
# it pivots on Massachusetts ZIP codes (01xxx / 02xxx) and walks up to the
# nearest entry-shaped container to find a name + phone + website, so a
# best-effort row stream still flows downstream even when the site has
# rebranded its DOM.

_MA_ZIP_RE = re.compile(r"\b(0[12]\d{3})(?:-\d{4})?\b")
_NANP_PHONE_RE = re.compile(r"\(?\b\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b")

_HEADING_TAGS: tuple[str, ...] = ("h2", "h3", "h4", "h5", "h6")
_ENTRY_TAGS: tuple[str, ...] = ("article", "li", "tr", "div", "section")


def parse_html_directory_fallback(html: str) -> list[dict]:
    """Parse a directory page generically. Returns a list of
    ``{name, zip, phone, website}`` dicts, deduped by name.

    Two-pass strategy:

    Pass 1 — pivot on Massachusetts ZIP (01xxx or 02xxx):
      For each ZIP text-node, walk up to the nearest container tag
      (article / li / tr / div / section) and extract name + phone +
      website from inside that container.

    Pass 2 — pivot on NANP phone (when pass 1 yielded nothing):
      For each phone text-node, walk up similarly and extract a name.
      ZIP comes back blank in this case but the row is still a valid
      prospect — downstream contact-enrichment and dedupe can fill in
      the missing fields.

    Pivoting on ZIP gives the strongest signal where ZIPs are
    rendered (CSV-table directories), while phone-pivot rescues
    JS-rendered listings that publish phones but not ZIPs.

    Real production HTML changes more often than text content, so
    pivoting on these two stable text shapes is more durable than CSS
    class names.
    """
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "html.parser")
    out: list[dict] = []
    seen_names: set[str] = set()

    def _extract_from_container(container, *, zip_code: str | None) -> dict | None:
        if container is None or container.name == "html":
            return None
        name_el = None
        for tag in _HEADING_TAGS:
            cand = container.find(tag)
            if cand and cand.get_text(strip=True):
                name_el = cand
                break
        if name_el is None:
            cand = container.find(["strong", "b"])
            if cand and cand.get_text(strip=True):
                name_el = cand
        if name_el is None:
            return None
        name = name_el.get_text(strip=True)
        if len(name) < 3 or len(name) > 200:
            return None
        if name in seen_names:
            return None

        text_blob = container.get_text(" ", strip=True)
        phone_match = _NANP_PHONE_RE.search(text_blob)
        phone = phone_match.group(0).strip() if phone_match else None
        if zip_code is None:
            zm = _MA_ZIP_RE.search(text_blob)
            zip_code = zm.group(1) if zm else None

        website: str | None = None
        for a in container.find_all("a", href=True):
            href = a["href"].strip()
            if not href or href.startswith(("tel:", "mailto:", "#", "javascript:")):
                continue
            website = href
            break

        seen_names.add(name)
        return {
            "name": name,
            "zip": zip_code,
            "phone": phone,
            "website": website,
        }

    # Pass 1: ZIP-pivot.
    for text_node in soup.find_all(string=_MA_ZIP_RE):
        match = _MA_ZIP_RE.search(str(text_node))
        if not match:
            continue
        zip_code = match.group(1)
        container = text_node.parent
        while container is not None and container.name not in _ENTRY_TAGS:
            container = container.parent
        rec = _extract_from_container(container, zip_code=zip_code)
        if rec is not None:
            out.append(rec)

    if out:
        return out

    # Pass 2: phone-pivot fallback (JS-rendered directories that publish
    # phones in the rendered DOM but no ZIPs in the text).
    for text_node in soup.find_all(string=_NANP_PHONE_RE):
        if not _NANP_PHONE_RE.search(str(text_node)):
            continue
        container = text_node.parent
        while container is not None and container.name not in _ENTRY_TAGS:
            container = container.parent
        rec = _extract_from_container(container, zip_code=None)
        if rec is not None:
            out.append(rec)

    return out


def parse_noviams_directory(html: str) -> list[dict]:
    """Extract members from a Noviams-platform directory page.

    Noviams (used by MVMA, MA Arborists, and other smaller trade
    associations) renders each member as:

      <div class="member c-member-badge">
        <h4 class="c-member-badge__name">…</h4>
        <p class="c-member-badge__title-parent">Veterinarian, Foo Hospital</p>
        <p class="c-member-badge__phone">555-555-5555</p>
        <a class="c-member-badge__view-profile" href="…">View Profile</a>
      </div>

    Some platforms put the actual *business* name in
    ``c-member-badge__title-parent`` (after the role/title prefix and a
    comma) rather than ``__name`` (which can be the individual member).
    We prefer the business name when present.

    Returns ``[]`` when the page isn't a Noviams page (no badges found).
    """
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "html.parser")
    badges = soup.select("div.c-member-badge, div.member.c-member-badge")
    out: list[dict] = []
    seen_names: set[str] = set()

    for b in badges:
        name_el = b.select_one(".c-member-badge__name")
        parent_el = b.select_one(".c-member-badge__title-parent, .c-member-badge__parent")
        # Business name preference: prefer the practice/company name
        # from title-parent (after the first comma if present).
        business: str | None = None
        if parent_el:
            txt = parent_el.get_text(" ", strip=True)
            if "," in txt:
                # "Veterinarian, Atlantic Veterinary Hospital" → second half
                _, business = txt.split(",", 1)
                business = business.strip()
            else:
                business = txt
        if not business and name_el:
            business = name_el.get_text(" ", strip=True)
        if not business:
            continue
        if business in seen_names:
            continue
        seen_names.add(business)

        phone_el = b.select_one(".c-member-badge__phone")
        phone = phone_el.get_text(strip=True) if phone_el else None

        link_el = b.select_one("a.c-member-badge__view-profile") or b.select_one("a[href]")
        website = link_el.get("href") if link_el else None
        if website and website.startswith("/"):
            website = None  # relative profile URL is platform-internal, not a real website

        out.append(
            {
                "name": business,
                "zip": None,  # Noviams doesn't expose ZIP on the badge
                "phone": phone,
                "website": website,
            }
        )
    return out


def emit_via_html_fallback(
    html: str,
    *,
    source_key: str,
    category: str,
    pipeline_notes: str,
    tier: str = "C",
    sector: str | list[str] | None = None,
    operating_model: str | list[str] | None = None,
    cadence: str | list[str] | None = None,
    history: str | list[str] | None = None,
    zip_filter_permissive: bool = True,
) -> list[dict]:
    """Run :func:`parse_html_directory_fallback` and emit
    pipeline-shaped rows via :func:`build_row`. Used by HTML scrapers
    when their per-source CSS selectors yield zero rows.

    ``zip_filter_permissive=True`` (default) drops rows whose ZIP is
    explicitly out-of-zone but lets blank-ZIP rows through, matching
    plan §9.1's search-corpus design intent.
    """
    rows: list[dict] = []
    # Noviams platform first — most reliable when it's the right platform.
    records = parse_noviams_directory(html)
    if not records:
        records = parse_html_directory_fallback(html)
    for rec in records:
        name = rec.get("name") or ""
        if not acceptable_name(name):
            continue
        zip_code = rec.get("zip")
        if zip_filter_permissive and zip_code and not in_signal_zone(zip_code):
            continue
        rows.append(
            build_row(
                source_key=source_key,
                company_name=name,
                category=category,
                zip_code=zip_code,
                phone=rec.get("phone"),
                website=rec.get("website"),
                tier=tier,
                sector=sector,
                operating_model=operating_model,
                cadence=cadence,
                history=history,
                pipeline_notes=pipeline_notes,
            )
        )
    return rows
