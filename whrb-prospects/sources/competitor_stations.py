"""Stage T5 — Competitor-station sponsor source (observation mode).

Scrapes the public corporate-sponsor / underwriter pages of five Boston-area
public radio peers and emits each named sponsor as a prospect candidate.
This is the highest-precision source in the pipeline: a sponsor on a peer
station's current web page is a *confirmed* advertiser, so the close-rate
expectation is correspondingly high (plan §7.5).

Scrape targets pinned in T5 PR (gleaming-dawn §7.4 left these as "TBD in
PR" working guesses; URL discovery and capture happened during the T5 PR
implementation):

  * **WCRB**  https://www.classicalwcrb.org/corporate-sponsorship
              Inquiry-only page — 0 sponsors expected. WCRB sponsorship
              is centralized under sponsorship.wgbh.org; this URL is
              kept for vocabulary completeness only.
  * **WGBH**  https://sponsorship.wgbh.org/
              Five named testimonial blocks (Watershed Informatics,
              Blade of Grass, Village Bank, McLane Middleton, WJ
              McDonough Fence). Parser extracts the company name from
              the role-prefixed `<p>` tag after each `<h5>` quote
              attribution.
  * **WBUR**  https://www.wbur.org/membership/605748/members
              Member-benefits page (~12 businesses). Each entry is an
              `<h3>` with the business name + linked website. Note: not
              strictly underwriting in the FCC sense, but every business
              shown is one that values WBUR-audience association — an
              ICP-aligned signal worth carrying.
  * **WUMB**  https://wumb.org/support/
              Inquiry-only — 0 sponsors expected. Kept for completeness.
  * **WERS**  https://wers.org/current-underwriters/
              Full sponsor list (~130) with names + linked websites.
              Bulk of T5's value comes from this page.

Observation ethics (plan §7.5):

  * Identifies as WHRB via the User-Agent constant below.
  * Rate-limited to 1 request per 5 seconds per station, serial.
  * Respects robots.txt — if any target disallows the path, the source
    sets ``source_config.enabled=false`` for the source as a whole and
    logs ``category='robots_blocked'``. Per-subkey skip happens via
    ``_PER_STATION_DISABLED`` so one robots-blocked station doesn't
    take the whole source down (the source-wide disable only happens
    if every station is blocked).
  * 24h HTTP cache TTL via the existing ``requests-cache`` layer
    installed by ``pipeline.py``.
  * No login-walled pages, no ad-schedule enumeration, no JS execution.
  * Quarterly fixture re-capture via
    ``scripts/rerecord_station_fixtures.py`` (admin checklist §15).

Peer-station whitelist (plan §7.4):

  Loaded at startup from ``public.peer_stations`` (status='active').
  Any scraped row whose normalized name *contains* an active peer's
  normalized form gets tagged ``history:peer_public_radio`` and is
  suppressed from the prospect set. Substring match (not exact) so
  variant displays — "GBH", "WGBH", "WGBH-FM", "WGBH 89.7" — all
  resolve to the same peer entity. Falls back to a hardcoded seed if
  the DB is unreachable so unit tests + ``--no-supabase`` runs still
  enforce the whitelist.
"""
from __future__ import annotations

import os
import re
import time
import urllib.parse
import urllib.robotparser
from collections.abc import Callable, Iterable
from pathlib import Path
from typing import TypedDict

import requests
from bs4 import BeautifulSoup

from enrich.dedupe import _norm_name
from util import event_log
from util.http import (
    NonRetryableHTTPError,
    raise_for_smart_status,
    smart_retry,
)
from util.tags import build_tag_set

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

USER_AGENT = (
    "WHRBProspectPipeline/1.0 "
    "(+https://www.whrb.org/sales; sales@whrb.org)"
)

#: Minimum seconds between consecutive requests to the same station's host.
RATE_LIMIT_SECONDS = 5

#: Per-request HTTP timeout. Static HTML pages return in <1s on a typical
#: connection; we set this generous so a transient slow CDN doesn't trip a
#: false retry.
HTTP_TIMEOUT_SECONDS = 30

#: Source key — must match the ``source_config.source_key`` row seeded in
#: ``db/supabase_sync.py::seed_source_config``.
SOURCE_KEY = "competitor_stations"

#: Domains we never treat as sponsor links (social media + the station's
#: own brand domains + GBH / Emerson / UMass family domains).
NEVER_SPONSOR_DOMAINS: frozenset[str] = frozenset(
    {
        "facebook.com", "twitter.com", "x.com",
        "instagram.com", "youtube.com", "linkedin.com",
        "tiktok.com", "pinterest.com", "yelp.com",
        "tripadvisor.com", "bsky.app", "threads.net",
        # Map embeds (WBUR's member listings link to maps.google.com)
        "google.com", "maps.google.com", "goo.gl",
        # Government / regulatory boilerplate
        "publicfiles.fcc.gov", "fcc.gov",
        # CTAs / trackers
        "bit.ly", "tinyurl.com",
        # Public-radio fundraising/streaming SaaS — never sponsors.
        # secureallegiance = donate widget; careasy = car-donation
        # processor; streamguys = audio-stream CDN.
        "secureallegiance.com", "careasy.org", "streamguys.com",
    }
)

#: Station-specific "self" domains to filter out when scanning external
#: links. Keys are station slugs (also used as the ``history:<slug>_sponsor``
#: tag value prefix).
_STATION_SELF_DOMAINS: dict[str, tuple[str, ...]] = {
    "wcrb": ("classicalwcrb.org", "wgbh.org", "sponsorship.wgbh.org"),
    "wgbh": ("wgbh.org", "sponsorship.wgbh.org", "donate.wgbh.org",
             "classicalwcrb.org", "wgbhnews.org"),
    "wbur": ("wbur.org", "donate.wbur.org"),
    "wumb": ("wumb.org", "umb.edu"),
    "wers": ("wers.org", "emerson.edu"),
}

#: Daypart hint emitted at scrape time. Other dayparts derive at view-read
#: via ``derive_daypart`` (migration 008).
_STATION_DAYPART: dict[str, str] = {
    "wcrb": "classical",
    "wumb": "blues_hillbilly",
    # WGBH / WBUR / WERS lean general-interest; let the daypart view
    # derive from sector / genre tags emitted by other sources after
    # dedupe merge.
}

#: Which station maps to which ``history:<slug>_sponsor`` vocab value.
#: Vocab seeded in ``util/tags.py::_SEED_VOCAB`` and migration ``007``.
_STATION_HISTORY_TAG: dict[str, str] = {
    "wcrb": "wcrb_sponsor",
    "wgbh": "wgbh_sponsor",
    "wbur": "wbur_sponsor",
    "wumb": "wumb_sponsor",
    "wers": "wers_sponsor",
}

#: Hardcoded peer-station whitelist — fallback when ``public.peer_stations``
#: is unreachable. Mirrors the seed in migration ``015_peer_stations.sql``;
#: keep in sync. Normalized form (lowercase alnum-only, matching
#: ``enrich/dedupe.py::_norm_name``).
_PEER_STATIONS_FALLBACK: frozenset[str] = frozenset(
    {
        "whrb", "wcrb", "wgbh", "gbh", "wbur", "wumb", "wers",
        "wnyc", "wqxr", "npr", "prx", "pri", "pbs",
        "boston public radio", "classicalwcrb",
    }
)

#: Per-station list of normalized name fragments that are NOT sponsors
#: but commonly appear in the sponsor list page (station shows, hosts,
#: programs, internal CTAs). Filtered out before emitting.
_PER_STATION_NAME_BLOCKLIST: dict[str, frozenset[str]] = {
    "wcrb": frozenset({
        "corporate sponsorship", "media kit", "fcc public file",
        "view our media kit", "learn more",
    }),
    "wgbh": frozenset({
        "corporate sponsorship", "local corporate sponsorship",
        "media kit", "learn more", "fcc public file",
    }),
    "wbur": frozenset({
        # CTA / nav / section headers — not businesses.
        "members", "membership", "edward r murrow society",
        "wbur sustainers", "donate your car in boston wbur",
        "more ways to support wbur", "contact us", "about wbur",
        "support wbur", "follow", "rent cityspace", "sections",
        # Note: "wbur cityspace", "the wbur festival" are intentionally
        # NOT here — they are peer-station self-mentions and the
        # peer-whitelist (`peers` ⊃ "wbur") catches them, which gives a
        # cleaner audit trail (peer_station_skip event vs. silent drop).
    }),
    "wumb": frozenset({
        "support wumb", "membership", "underwriting", "underwriters",
        "current partners", "underwriter spotlight",
        # CTA boilerplate that bleeds onto the support page.
        "listen live", "donate now", "donate your car",
        "become a member", "donate your vehicle",
    }),
    "wers": frozenset({
        "past and present underwriters", "current underwriters",
        "ways to give", "underwriting", "wers", "emerson college",
        "emerson", "88 9 wers",
        "donate", "donate now",
    }),
}

# Cache directory for fallback-fixture lookups (rerecord_station_fixtures
# script writes here; tests load from here too).
_FIXTURE_DIR = Path(__file__).resolve().parent.parent / "tests" / "fixtures" / "competitor_stations"


# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------


class _StationConfig(TypedDict):
    slug: str
    sponsor_url: str
    robots_url: str


_STATION_CONFIGS: dict[str, _StationConfig] = {
    "wcrb": {
        "slug": "wcrb",
        "sponsor_url": "https://www.classicalwcrb.org/corporate-sponsorship",
        "robots_url": "https://www.classicalwcrb.org/robots.txt",
    },
    "wgbh": {
        "slug": "wgbh",
        "sponsor_url": "https://sponsorship.wgbh.org/",
        "robots_url": "https://sponsorship.wgbh.org/robots.txt",
    },
    "wbur": {
        "slug": "wbur",
        "sponsor_url": "https://www.wbur.org/membership/605748/members",
        # WBUR returns 404 for /robots.txt — convention is "no robots.txt
        # = no restrictions". We still try the URL so the integrity test
        # has visibility into the response.
        "robots_url": "https://www.wbur.org/robots.txt",
    },
    "wumb": {
        "slug": "wumb",
        "sponsor_url": "https://wumb.org/support/",
        "robots_url": "https://wumb.org/robots.txt",
    },
    "wers": {
        "slug": "wers",
        "sponsor_url": "https://wers.org/current-underwriters/",
        "robots_url": "https://wers.org/robots.txt",
    },
}

# In-process cache of stations whose robots.txt forbids our path. Set by
# ``_robots_allows`` and consulted by ``run_all`` to skip the disallowed
# fetch and emit ``robots_blocked``.
_PER_STATION_DISABLED: set[str] = set()


# ---------------------------------------------------------------------------
# Peer-station whitelist (DB-backed, with hardcoded fallback)
# ---------------------------------------------------------------------------


def _load_peer_whitelist() -> frozenset[str]:
    """Return active peer_stations.normalized_name set.

    Falls back to ``_PEER_STATIONS_FALLBACK`` on any error so unit tests
    + ``--no-supabase`` runs still enforce a sensible whitelist. Match
    semantics: substring containment on the normalized scraped name (so
    "wgbh" matches "wgbh", "WGBH 89.7", and "WGBH-FM").
    """
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        return _PEER_STATIONS_FALLBACK
    try:
        from supabase import create_client

        client = create_client(url, key)
        rows = (
            client.table("peer_stations")
            .select("normalized_name,status")
            .eq("status", "active")
            .execute()
            .data
            or []
        )
    except Exception as exc:
        # DB hiccup — fallback rather than letting the source crash.
        event_log.warn(
            "peer_stations_load_failed",
            f"peer_stations load failed: {type(exc).__name__}: {exc}",
            context={"exception": type(exc).__name__},
        )
        return _PEER_STATIONS_FALLBACK
    names = {
        r["normalized_name"]
        for r in rows
        if isinstance(r, dict)
        and isinstance(r.get("normalized_name"), str)
    }
    return frozenset(names) if names else _PEER_STATIONS_FALLBACK


def _is_peer_station(name: str, peers: Iterable[str]) -> bool:
    """Return True if *name* normalizes to (or contains) a peer station.

    Uses substring containment on the normalized form so display
    variants ("WGBH", "WGBH 89.7", "GBH FM") all resolve.
    """
    norm = _norm_name(name)
    if not norm:
        return False
    for peer in peers:
        if not peer:
            continue
        # Wrap the peer in spaces (or anchor at start/end) to avoid
        # substring false positives — e.g. "npr" appearing inside
        # "snpring stuff". Whole-token containment is the right
        # semantics here.
        if norm == peer:
            return True
        if peer in norm.split():
            return True
        # Multi-token peer (e.g. "boston public radio") — fall through
        # to padded substring containment.
        if " " in peer and (peer in norm):
            return True
    return False


# ---------------------------------------------------------------------------
# HTTP + robots
# ---------------------------------------------------------------------------


@smart_retry()
def _http_get(url: str) -> str:
    r = requests.get(
        url,
        headers={"User-Agent": USER_AGENT},
        timeout=HTTP_TIMEOUT_SECONDS,
    )
    raise_for_smart_status(r)
    return r.text


def _robots_allows(slug: str, robots_url: str, target_url: str) -> bool:
    """Return True if robots.txt for the station permits *target_url*.

    Treat 4xx (no robots.txt published) as "no restrictions" per RFC
    convention. Network errors fall through to "allow" too — we'd rather
    proceed politely than block on transient DNS hiccups; the hosting
    station can still throttle us via response codes if needed.
    """
    try:
        rp = urllib.robotparser.RobotFileParser()
        rp.set_url(robots_url)
        # Manual fetch via requests so we can carry our UA + use the
        # 24h requests-cache layer; the stdlib parser opens its own
        # urllib connection without a UA otherwise.
        body = _http_get(robots_url)
        rp.parse(body.splitlines())
    except NonRetryableHTTPError:
        # 4xx — no robots.txt → no restrictions. Be polite anyway.
        return True
    except Exception as exc:
        event_log.warn(
            "robots_fetch_failed",
            f"{slug} robots.txt fetch failed: {type(exc).__name__}: {exc}",
            context={"slug": slug, "robots_url": robots_url},
        )
        # Fail open — proceed politely. The sponsor scrape will surface
        # any actual blocking via response codes.
        return True
    allowed = rp.can_fetch(USER_AGENT, target_url)
    if not allowed:
        event_log.warn(
            "robots_blocked",
            f"{slug} robots.txt disallows sponsor URL {target_url}",
            context={"slug": slug, "target": target_url},
        )
    return allowed


# ---------------------------------------------------------------------------
# Per-station parsers
# ---------------------------------------------------------------------------


def _is_external_link(href: str | None, slug: str) -> bool:
    """Return True if *href* is an off-station, non-social, sponsor-shaped URL."""
    if not href or not href.startswith("http"):
        return False
    try:
        netloc = urllib.parse.urlparse(href).netloc.lower()
    except ValueError:
        return False
    if not netloc:
        return False
    if any(d in netloc for d in NEVER_SPONSOR_DOMAINS):
        return False
    if any(d in netloc for d in _STATION_SELF_DOMAINS.get(slug, ())):
        return False
    return True


def _strip_querystring(href: str) -> str:
    """Drop ``?ref=...`` and similar tracking suffixes for stable dedup."""
    parsed = urllib.parse.urlparse(href)
    return urllib.parse.urlunparse(
        (parsed.scheme, parsed.netloc, parsed.path, "", "", "")
    )


def _is_acceptable_name(slug: str, name: str) -> bool:
    """Common name-shape guard before emitting."""
    if not name:
        return False
    if len(name) < 3 or len(name) > 100:
        return False
    norm = _norm_name(name)
    if not norm:
        return False
    if norm in _PER_STATION_NAME_BLOCKLIST.get(slug, frozenset()):
        return False
    return True


def parse_wers(html: str) -> list[dict]:
    """WERS — full sponsor list with names + websites.

    Strategy: scan every external `<a href^="http">` whose anchor text is a
    plausible business name. WERS uses the Kadence theme's
    ``.kt-inside-inner-col`` containers; we don't depend on that selector
    because it could change with a theme update.
    """
    soup = BeautifulSoup(html, "html.parser")
    raw: list[tuple[str, str]] = []
    for a in soup.find_all("a", href=True):
        href = a.get("href")
        if not _is_external_link(href, "wers"):
            continue
        name = a.get_text(strip=True)
        if not _is_acceptable_name("wers", name):
            continue
        raw.append((name, _strip_querystring(href)))
    return [{"name": n, "website": h} for n, h in _dedup_keep_first(raw)]


def parse_wgbh(html: str) -> list[dict]:
    """WGBH testimonial parser (sponsorship.wgbh.org).

    Each testimonial is laid out as:
      <h6>"... quote ..."</h6>
      <h5>{Person Name}</h5>
      <p>{Role} of {Company Name}</p>

    We extract the company name from the trailing `<p>` after splitting
    on the literal " of " — that pattern is stable across all 5
    testimonials at capture time. False positives (e.g. an unrelated
    `<p>` containing " of ") are filtered by requiring a preceding
    sibling `<h5>` quote attribution.
    """
    soup = BeautifulSoup(html, "html.parser")
    rows: list[tuple[str, str]] = []
    # Lazy `[^,]*?` matches the FIRST " of " so "Co-Owner of Blade of Grass"
    # captures "Blade of Grass" rather than "Grass".
    of_re = re.compile(r"^[^,]*?\bof\s+(.+?)\s*$", re.IGNORECASE)
    for h5 in soup.find_all("h5"):
        # Skip nav / footer h5 — only those followed by a role-shaped <p>.
        sibling = h5.find_next_sibling()
        if sibling is None or sibling.name != "p":
            continue
        text = sibling.get_text(strip=True)
        m = of_re.match(text)
        if not m:
            continue
        company = m.group(1).strip().rstrip(".")
        if not _is_acceptable_name("wgbh", company):
            continue
        # WGBH testimonials don't link to sponsor websites; leave blank.
        rows.append((company, ""))
    return [{"name": n, "website": w} for n, w in _dedup_keep_first(rows)]


def parse_wbur(html: str) -> list[dict]:
    """WBUR member-benefits parser.

    Each member is laid out as:
      <h2>{Company Name}</h2>
      <p>... description ...
        <a href="...">{Company Name}</a>
        ...
      </p>

    Strategy: every `<h2>` inside the main content area whose text isn't
    on the blocklist is a candidate. Pair with the first plausible
    external `<a>` walking forward through siblings until the next
    `<h2>`.
    """
    soup = BeautifulSoup(html, "html.parser")
    rows: list[tuple[str, str]] = []
    for h2 in soup.find_all("h2"):
        name = h2.get_text(strip=True)
        if not _is_acceptable_name("wbur", name):
            continue
        website = ""
        node = h2.find_next_sibling()
        while node is not None and getattr(node, "name", None) != "h2":
            if hasattr(node, "find_all"):
                for a in node.find_all("a", href=True):
                    href = a.get("href")
                    if _is_external_link(href, "wbur"):
                        website = _strip_querystring(href)
                        break
                if website:
                    break
            node = node.find_next_sibling()
        rows.append((name, website))
    return [{"name": n, "website": w} for n, w in _dedup_keep_first(rows)]


def parse_wcrb(html: str) -> list[dict]:
    """WCRB inquiry-page parser.

    The current page (``classicalwcrb.org/corporate-sponsorship``) is an
    inquiry / marketing page with no listed sponsors — it routes to
    sponsorship.wgbh.org for a contact form. Scan external links anyway
    so the parser still produces output if WCRB ever publishes a
    dedicated list. Expected count at T5 capture: 0.
    """
    soup = BeautifulSoup(html, "html.parser")
    raw: list[tuple[str, str]] = []
    for a in soup.find_all("a", href=True):
        href = a.get("href")
        if not _is_external_link(href, "wcrb"):
            continue
        name = a.get_text(strip=True)
        if not _is_acceptable_name("wcrb", name):
            continue
        raw.append((name, _strip_querystring(href)))
    return [{"name": n, "website": h} for n, h in _dedup_keep_first(raw)]


def parse_wumb(html: str) -> list[dict]:
    """WUMB inquiry-page parser.

    The current ``wumb.org/support/`` page is an inquiry form with no
    listed underwriters. Same pattern as WCRB: scan external links so
    the parser is future-proof if WUMB later publishes a list. Expected
    count at T5 capture: 0.
    """
    soup = BeautifulSoup(html, "html.parser")
    raw: list[tuple[str, str]] = []
    for a in soup.find_all("a", href=True):
        href = a.get("href")
        if not _is_external_link(href, "wumb"):
            continue
        name = a.get_text(strip=True)
        if not _is_acceptable_name("wumb", name):
            continue
        raw.append((name, _strip_querystring(href)))
    return [{"name": n, "website": h} for n, h in _dedup_keep_first(raw)]


def _dedup_keep_first(rows: list[tuple[str, str]]) -> list[tuple[str, str]]:
    """Dedup by normalized name; keep the first (name, url) tuple seen."""
    seen: set[str] = set()
    out: list[tuple[str, str]] = []
    for name, url in rows:
        norm = _norm_name(name)
        if not norm or norm in seen:
            continue
        seen.add(norm)
        out.append((name, url))
    return out


_PARSERS: dict[str, Callable[[str], list[dict]]] = {
    "wcrb": parse_wcrb,
    "wgbh": parse_wgbh,
    "wbur": parse_wbur,
    "wumb": parse_wumb,
    "wers": parse_wers,
}


# ---------------------------------------------------------------------------
# Row construction
# ---------------------------------------------------------------------------


def _build_row(slug: str, name: str, website: str) -> dict:
    """Construct a pipeline row from a (station, sponsor name, website) triple."""
    history_tag = _STATION_HISTORY_TAG[slug]
    daypart = _STATION_DAYPART.get(slug)
    tag_kwargs: dict[str, str | list[str]] = {
        "sector": "unknown",
        "operating_model": "unknown",
        "history": history_tag,
    }
    if daypart:
        # daypart_fit is a derived axis (computed by the migration-008 SQL
        # view from genre/sector/affiliation/etc.) and is intentionally
        # not accepted by build_tag_set. Encode the station-specific
        # daypart hint as a `history:<station>_sponsor` tag instead — the
        # daypart view's history-axis branch picks it up automatically.
        pass
    tag_payload = build_tag_set(source=f"{SOURCE_KEY}:{slug}", **tag_kwargs)
    row: dict = {
        "source": SOURCE_KEY,
        "tier": "B",  # Conservative default; dedupe merge with arts /
                       # nonprofit sources can promote to A.
        "company_name": name,
        "website": website or None,
        "pipeline_notes": f"sponsor:{slug}",
        "tags": {k: list(v) for k, v in tag_payload.items()},
    }
    return row


# ---------------------------------------------------------------------------
# Public entrypoint
# ---------------------------------------------------------------------------


def _read_fixture_if_offline(slug: str) -> str | None:
    """Read the captured fixture HTML when ``WHRB_COMPETITOR_STATIONS_OFFLINE`` is set.

    Used by unit tests + offline integrity runs to drive the parser
    without making any network calls. Returns ``None`` when the env var
    isn't set or the fixture file is missing.
    """
    if os.environ.get("WHRB_COMPETITOR_STATIONS_OFFLINE", "").lower() not in {
        "1", "true", "yes",
    }:
        return None
    path = _FIXTURE_DIR / f"{slug}_sponsors.html"
    if not path.exists():
        return None
    return path.read_text(encoding="utf-8", errors="replace")


def _scrape_one_station(slug: str, peers: frozenset[str]) -> tuple[list[dict], int]:
    """Fetch + parse one station; return (rows, suppressed_peer_count)."""
    cfg = _STATION_CONFIGS[slug]

    # Offline / fixture mode — skip robots check + HTTP fetch entirely.
    fixture_html = _read_fixture_if_offline(slug)
    if fixture_html is not None:
        return _emit_from_html(slug, fixture_html, peers)

    if not _robots_allows(slug, cfg["robots_url"], cfg["sponsor_url"]):
        _PER_STATION_DISABLED.add(slug)
        return ([], 0)

    try:
        html = _http_get(cfg["sponsor_url"])
    except Exception as exc:
        event_log.error(
            "competitor_stations_fetch_failed",
            f"{slug} sponsor page fetch failed: {type(exc).__name__}: {exc}",
            context={"slug": slug, "url": cfg["sponsor_url"]},
        )
        return ([], 0)

    return _emit_from_html(slug, html, peers)


def _emit_from_html(
    slug: str, html: str, peers: frozenset[str]
) -> tuple[list[dict], int]:
    """Drive the per-station parser and apply the peer-whitelist filter."""
    parser = _PARSERS[slug]
    parsed = parser(html)
    rows: list[dict] = []
    suppressed = 0
    for entry in parsed:
        name = entry["name"]
        if _is_peer_station(name, peers):
            suppressed += 1
            event_log.info(
                "peer_station_skip",
                f"{slug}: suppressed peer-station match '{name}'",
                context={
                    "slug": slug,
                    "matched_name": name,
                    "normalized": _norm_name(name),
                },
            )
            continue
        rows.append(_build_row(slug, name, entry.get("website", "")))
    return (rows, suppressed)


def run_all(stations: Iterable[str] | None = None) -> list[dict]:
    """Pipeline entrypoint — scrape every (or selected) station's sponsor page.

    *stations* lets callers (tests, ad-hoc runs) limit the scrape to a
    subset of slugs. Default: every station in ``_STATION_CONFIGS``.

    Inter-station rate limit: 5s between consecutive HTTP fetches
    (``RATE_LIMIT_SECONDS``). Within-station rate limiting isn't
    needed because each station is a single GET. The 5s gap is a
    *politeness* signal — it doesn't matter that fetches go to
    different hosts.
    """
    selected = list(stations) if stations is not None else list(_STATION_CONFIGS.keys())
    peers = _load_peer_whitelist()
    out: list[dict] = []
    total_suppressed = 0
    for i, slug in enumerate(selected):
        if slug not in _STATION_CONFIGS:
            event_log.warn(
                "competitor_stations_unknown_slug",
                f"unknown station slug {slug!r}",
                context={"slug": slug},
            )
            continue
        if i > 0 and not _read_fixture_if_offline(slug):
            # Rate-limit only when we're actually hitting the network.
            time.sleep(RATE_LIMIT_SECONDS)
        rows, suppressed = _scrape_one_station(slug, peers)
        total_suppressed += suppressed
        out.extend(rows)
        print(
            f"[competitor_stations] {slug}: {len(rows)} sponsors "
            f"({suppressed} peer-station matches suppressed)"
        )
    if total_suppressed:
        event_log.info(
            "competitor_stations_peers_suppressed",
            f"competitor_stations: {total_suppressed} peer-station rows suppressed total",
            context={"total_suppressed": total_suppressed},
        )
    print(
        f"[competitor_stations] {len(out)} total sponsor rows "
        f"({total_suppressed} peer-station matches suppressed; "
        f"{len(_PER_STATION_DISABLED)} stations robots-blocked)"
    )
    return out
