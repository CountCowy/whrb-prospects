"""Shared helpers for the T6 source batch.

Every T6 source emits the same kind of polite, observation-mode HTTP
request the T5 ``competitor_stations`` source pioneered. Pulling the
plumbing into a single module keeps each source file's parser logic
focused on its target's HTML shape.

Public API:

* :data:`USER_AGENT` — the WHRB-identifying UA string used by every T6
  source. Mirrors :data:`sources.competitor_stations.USER_AGENT` so a
  destination only sees one UA from us.
* :data:`RATE_LIMIT_SECONDS` — minimum seconds between consecutive
  requests to the same host. Per-host accounting via
  :func:`per_host_sleep`.
* :data:`HTTP_TIMEOUT_SECONDS` — per-request timeout.
* :data:`NEVER_SPONSOR_DOMAINS` — superset of T5's never-sponsor list
  (social + station boilerplate + nonprofit fundraising platforms).
* :func:`http_get` — UA-stamped, smart-retry-wrapped GET.
* :func:`is_external_link` — drop social + the source's own brand
  domains + the never-sponsor list.
* :func:`strip_querystring` — shave ``?utm_*`` off a sponsor URL for
  stable dedupe.
* :func:`acceptable_name` — name-shape guard (length, blocklist).
* :func:`per_host_sleep` — block until the per-host rate limit elapses.
* :func:`infer_sector_from_name` — token-based sector heuristic for
  corporate-sponsor pages where the source itself doesn't reveal
  industry.
* :func:`read_fixture` — offline-mode helper, mirrors
  ``competitor_stations._read_fixture_if_offline``.

Offline mode:

  Set ``WHRB_T6_OFFLINE=1`` to make every T6 source read its captured
  fixture from ``tests/fixtures/t6/<source>/<slug>.html`` instead of
  hitting the network. The integrity script + parser unit tests rely
  on this; the live pipeline run unsets the var.
"""
from __future__ import annotations

import os
import re
import time
import urllib.parse
from collections.abc import Iterable
from pathlib import Path

import requests

from enrich.dedupe import _norm_name
from util.http import raise_for_smart_status, smart_retry

USER_AGENT = (
    "WHRBProspectPipeline/1.0 "
    "(+https://www.whrb.org/sales; sales@whrb.org)"
)

RATE_LIMIT_SECONDS = 5
HTTP_TIMEOUT_SECONDS = 30

# Plan §8.2 + §8.5: each T6 source belongs to its own subdir under
# tests/fixtures/t6/<source_key>/.
FIXTURE_ROOT = (
    Path(__file__).resolve().parent.parent / "tests" / "fixtures" / "t6"
)


# ----------------------------------------------------------------------------
# URL filtering
# ----------------------------------------------------------------------------

#: Domains that are never sponsor websites — social, mapping, donate-flow
#: SaaS, generic CDNs. Same shape as competitor_stations.NEVER_SPONSOR_DOMAINS
#: but tuned for the broader T6 site mix (museums and ensembles often link
#: out to ticketing/membership processors).
NEVER_SPONSOR_DOMAINS: frozenset[str] = frozenset(
    {
        # Social.
        "facebook.com", "twitter.com", "x.com",
        "instagram.com", "youtube.com", "linkedin.com",
        "tiktok.com", "pinterest.com", "yelp.com",
        "tripadvisor.com", "bsky.app", "threads.net",
        "vimeo.com", "soundcloud.com", "spotify.com",
        "apple.com", "music.apple.com", "podcasts.apple.com",
        # Maps + tracking.
        "google.com", "maps.google.com", "goo.gl",
        "bit.ly", "tinyurl.com", "lnkd.in",
        # Government / regulatory boilerplate.
        "publicfiles.fcc.gov", "fcc.gov",
        # Nonprofit/arts ticketing + donate processors.
        "givebutter.com", "donorbox.org", "classy.org", "bloomerang.com",
        "salsalabs.com", "engagingnetworks.app",
        "thankview.com", "stripe.com", "paypal.com", "venmo.com",
        # Generic CDNs / tracking.
        "doubleclick.net", "googletagmanager.com", "google-analytics.com",
        "fbcdn.net", "cloudfront.net", "akamaihd.net",
        # Email + scheduling SaaS sometimes embedded as "contact us" links.
        "mailchimp.com", "constantcontact.com", "calendly.com",
    }
)


def is_external_link(href: str | None, self_domains: Iterable[str]) -> bool:
    """Return True if *href* points off-site, isn't social/never-sponsor,
    and isn't one of the source's own brand domains.

    *self_domains* lets each source pass its own list (e.g. Boston
    Ballet's site links liberally to ``bostonballet.org`` itself; we
    don't want those treated as sponsor links).
    """
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
    if any(d in netloc for d in self_domains):
        return False
    return True


def strip_querystring(href: str) -> str:
    """Drop ``?utm_*=...`` and similar tracking suffixes for stable dedupe."""
    parsed = urllib.parse.urlparse(href)
    return urllib.parse.urlunparse(
        (parsed.scheme, parsed.netloc, parsed.path, "", "", "")
    )


# ----------------------------------------------------------------------------
# Name guards
# ----------------------------------------------------------------------------

#: Cross-source name blocklist — fragments that show up across many
#: sponsor pages but are never businesses (CTAs, page metadata, nav).
_GENERIC_BLOCKLIST: frozenset[str] = frozenset(
    {
        "learn more", "read more", "see more", "show more",
        "click here", "here", "more info", "contact us",
        "donate", "donate now", "support us", "give now",
        "subscribe", "subscribe now", "sign up", "sign in",
        "log in", "login", "join us", "membership",
        "buy tickets", "tickets", "buy now",
        "see all", "view all", "view more", "show all",
        "previous", "next", "back", "home",
        "share", "share this", "tweet", "post",
        "skip to content", "skip to main content",
        "main menu", "menu", "search",
        "privacy policy", "terms of use", "terms of service",
        "cookie policy", "accessibility", "site map", "sitemap",
        "all rights reserved",
    }
)


def acceptable_name(
    name: str | None,
    *,
    extra_blocklist: Iterable[str] = (),
    min_len: int = 3,
    max_len: int = 100,
) -> bool:
    """Common name-shape guard: length window + blocklist."""
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


def dedup_keep_first(
    rows: list[tuple[str, str]],
) -> list[tuple[str, str]]:
    """Dedup ``(name, url)`` tuples by ``_norm_name(name)``; keep first."""
    seen: set[str] = set()
    out: list[tuple[str, str]] = []
    for name, url in rows:
        norm = _norm_name(name)
        if not norm or norm in seen:
            continue
        seen.add(norm)
        out.append((name, url))
    return out


# ----------------------------------------------------------------------------
# Sector heuristics
# ----------------------------------------------------------------------------

#: Mapping of token fragments -> sector vocab values. Used by
#: ``corporate_sponsor_pages.py`` (and any other source where the page
#: itself reveals nothing about the sponsor's industry). First match wins.
#: Keep generic — when in doubt the row stays ``sector:unknown`` so dedupe
#: can refine via collisions with sector-aware sources (OSM, Yelp).
_SECTOR_TOKEN_HINTS: tuple[tuple[tuple[str, ...], str], ...] = (
    # Finance / wealth / banking.
    (("bank", "banking", "trust company", "wealth", "capital", "investments",
      "asset management", "private banking", "credit union", "financial",
      "fidelity", "vanguard", "putnam"),
     "finance"),
    # Legal.
    (("law firm", "attorneys", "& associates", "llp", "llc", "p.c.",
      "esq", "lardner", "wilmerhale", "ropes", "goodwin",
      "skadden", "kirkland"),
     "finance"),  # legal sits in finance bucket per existing config.
    # Medical / health.
    (("hospital", "medical center", "clinic", "health system", "health network",
      "physicians", "dental", "orthodontics", "vision", "optometry",
      "audiology", "physical therapy", "rehabilitation"),
     "medical"),
    # Education (incl. private K-12 + adult).
    (("school", "academy", "college", "university", "institute", "learning",
      "education", "tutoring"),
     "education"),
    # Hospitality / restaurants.
    (("restaurant", "kitchen", "tavern", "cafe", "café", "bistro", "bar",
      "trattoria", "ristorante", "brasserie", "wine", "vineyard",
      "hotel", "inn", "resort", "lodge"),
     "hospitality"),
    # Retail / boutique.
    (("jeweler", "jewelry", "boutique", "books", "bookstore", "shop",
      "gallery", "florist", "flower", "fine art"),
     "retail"),
    # Real estate / property.
    (("real estate", "realty", "properties", "property management",
      "homes", "developments"),
     "real_estate"),
    # Technology / software.
    (("technologies", "technology", "software", "systems", "informatics",
      "ai ", "data", "platform", "cloud"),
     "technology"),
    # Arts / cultural orgs (often appear as sponsors of OTHER arts orgs).
    (("symphony", "orchestra", "ballet", "opera", "theatre", "theater",
      "museum", "society", "ensemble", "chorus", "consort", "chamber music"),
     "arts"),
    # Religious.
    (("church", "temple", "synagogue", "mosque", "parish", "diocese",
      "ministry"),
     "religious"),
)


def infer_sector_from_name(name: str | None) -> str | None:
    """Return a sector vocab value if *name*'s tokens hint at one.

    First-match wins; generic-only rules sit later in the tuple. Returns
    ``None`` when no token heuristic fires; the caller emits
    ``sector:unknown`` in that case.
    """
    if not name:
        return None
    haystack = name.lower()
    for fragments, sector in _SECTOR_TOKEN_HINTS:
        for frag in fragments:
            if frag in haystack:
                return sector
    return None


# ----------------------------------------------------------------------------
# Per-host rate limiting
# ----------------------------------------------------------------------------

_LAST_FETCH: dict[str, float] = {}


def per_host_sleep(url: str, *, seconds: float = RATE_LIMIT_SECONDS) -> None:
    """Block until at least *seconds* have passed since the last fetch
    to *url*'s host (exact host match, not eTLD+1).

    Tracks per-host wall-clock timestamps in a module-level dict.
    Modules that compose multiple sources within a single ``run_all``
    inherit the same throttle map for free.
    """
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
    """Clear the per-host throttle map. For tests."""
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
# Offline-fixture mode
# ----------------------------------------------------------------------------


def _offline_enabled() -> bool:
    raw = os.environ.get("WHRB_T6_OFFLINE", "").strip().lower()
    return raw in {"1", "true", "yes"}


def read_fixture(source_key: str, slug: str) -> str | None:
    """Return fixture HTML for ``tests/fixtures/t6/<source_key>/<slug>.html``.

    Returns ``None`` when offline mode is off OR the fixture is missing.
    """
    if not _offline_enabled():
        return None
    path = FIXTURE_ROOT / source_key / f"{slug}.html"
    if not path.exists():
        return None
    return path.read_text(encoding="utf-8", errors="replace")


# ----------------------------------------------------------------------------
# Anchor-text emission helpers
# ----------------------------------------------------------------------------

#: Pattern that matches "(c) 2026 Whatever LLC" and similar copyright bylines
#: that bleed into anchor text.
_COPYRIGHT_RE = re.compile(
    r"^\s*(?:copyright\s+)?[©(c)]+\s*\d{4}\s*",
    re.IGNORECASE,
)


def clean_anchor_text(raw: str) -> str:
    """Strip whitespace, copyright bylines, and trailing punctuation."""
    s = (raw or "").strip()
    s = _COPYRIGHT_RE.sub("", s)
    s = s.rstrip(".,;:")
    return s.strip()
