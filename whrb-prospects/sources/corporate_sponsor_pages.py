"""Stage T6 — Static corporate-sponsor pages for major Boston cultural anchors.

Plan §8.4 #3. Ten target pages, each with its own DOM shape; we keep the
per-target parser logic minimal (most reduce to "harvest external `<a>` tags
under the main content area") and lean on
``sources/_sponsor_pages_common.py`` for the shared plumbing.

Targets (all live):

  * Boston Ballet Corporate Partners
  * BSO Business Partners (current)
  * BSO Pops Corporate Sponsors
  * ICA Boston Current Corporate Partners
  * MFA Corporate Members
  * NEC Corporate Partnerships
  * BPL Fund Donors (Boston Public Library)
  * Huntington Theatre Institutional Supporters
  * Boston Early Music Festival Ways To Give
  * Friends of the Public Garden Corporate Support

Per-row tags emitted:

  * ``history:program_book_sponsor`` (T1 seed)
  * ``sector:<inferred>`` via
    :func:`sources._sponsor_pages_common.infer_sector_from_name` — falls
    back to ``sector:unknown`` so dedupe can refine via OSM/Yelp/MA-HIC
    collisions.
  * ``affiliation:unknown`` — geographic affiliation is not derivable from
    the page; leave it for cross-source merge.
  * ``operating_model`` — left out (the row's industry isn't determinable
    from the page; the merge with other sources fills it in).
"""
from __future__ import annotations

from typing import TypedDict

from bs4 import BeautifulSoup

from sources import _sponsor_pages_common as common
from util import event_log
from util.tags import build_tag_set

SOURCE_KEY = "corporate_sponsor_pages"


class _Target(TypedDict):
    slug: str
    url: str
    self_domains: tuple[str, ...]
    name_blocklist: tuple[str, ...]


_TARGETS: dict[str, _Target] = {
    "boston_ballet": {
        "slug": "boston_ballet",
        "url": "https://www.bostonballet.org/home/support/corporate-partners/",
        "self_domains": ("bostonballet.org",),
        "name_blocklist": (
            "boston ballet", "corporate partners", "support",
            "shop", "the boston ballet store", "ticket office",
            "newsletter", "membership", "school", "studio company",
        ),
    },
    "bso_business": {
        "slug": "bso_business",
        "url": (
            "https://www.bso.org/support/corporate-partnerships/"
            "bso-business-partners/current-business-partners"
        ),
        "self_domains": ("bso.org", "tanglewood.org"),
        "name_blocklist": (
            "boston symphony orchestra", "bso", "tanglewood",
            "current business partners", "business partners",
            "corporate partnerships", "support",
        ),
    },
    "bso_pops": {
        "slug": "bso_pops",
        "url": "https://www.bso.org/pops/support/corporate-sponsors",
        "self_domains": ("bso.org", "bostonpops.org"),
        "name_blocklist": (
            "boston pops", "boston symphony orchestra",
            "pops on the heath", "holiday pops",
            "corporate sponsors", "support",
        ),
    },
    "ica_boston": {
        "slug": "ica_boston",
        "url": "https://www.icaboston.org/current-corporate-partners/",
        "self_domains": ("icaboston.org",),
        "name_blocklist": (
            "ica", "institute of contemporary art", "ica boston",
            "current corporate partners", "membership",
        ),
    },
    "mfa": {
        "slug": "mfa",
        "url": "https://www.mfa.org/give/corporate-membership/member-listing",
        "self_domains": ("mfa.org",),
        "name_blocklist": (
            "mfa", "museum of fine arts", "member listing",
            "corporate membership", "give", "membership",
        ),
    },
    "nec": {
        "slug": "nec",
        "url": "https://necmusic.edu/give/corporate-partnerships/",
        "self_domains": ("necmusic.edu",),
        "name_blocklist": (
            "new england conservatory", "necmusic.edu",
            "corporate partnerships", "give", "support",
        ),
    },
    "bpl": {
        "slug": "bpl",
        "url": "https://bplfund.org/donors/",
        "self_domains": ("bplfund.org", "bpl.org"),
        "name_blocklist": (
            "boston public library fund", "boston public library",
            "donors", "ways to give", "support",
        ),
    },
    "huntington": {
        "slug": "huntington",
        # Plan-specified URL `/support-us/supporters/institution/` returned
        # 404 at fixture-capture time. The Huntington routes its supporter
        # listing under `/about/sponsors/` (mirrors the program-books
        # fetcher in sources/program_books_fetcher.py::HUNTINGTON_SPONSORS_URL).
        "url": "https://huntingtontheatre.org/about/sponsors/",
        "self_domains": ("huntingtontheatre.org",),
        "name_blocklist": (
            "huntington theatre", "huntington",
            "institutional supporters", "supporters", "support us",
            "about", "sponsors",
        ),
    },
    "bemf": {
        "slug": "bemf",
        "url": "https://bemf.org/support-bemf/ways-to-give/",
        "self_domains": ("bemf.org",),
        "name_blocklist": (
            "boston early music festival", "bemf",
            "ways to give", "support bemf",
        ),
    },
    "fopg": {
        "slug": "fopg",
        "url": (
            "https://friendsofthepublicgarden.org/donate/corporate-support/"
        ),
        "self_domains": ("friendsofthepublicgarden.org",),
        "name_blocklist": (
            "friends of the public garden", "the public garden",
            "corporate support", "donate",
        ),
    },
}


# ----------------------------------------------------------------------------
# Per-target parser
# ----------------------------------------------------------------------------


def _parse(slug: str, html: str) -> list[tuple[str, str]]:
    """Generic external-link harvester scoped to *slug*'s self-domain list.

    Each cultural anchor's HTML shape is different but they share the
    same emit shape: an external-pointing ``<a>`` whose visible text is
    the sponsor name, optionally wrapped in a ``<li>`` / ``<div>``
    container. The shared parser walks every external ``<a>`` and
    applies the same name guard.
    """
    target = _TARGETS[slug]
    soup = BeautifulSoup(html, "html.parser")
    raw: list[tuple[str, str]] = []
    for a in soup.find_all("a", href=True):
        href = a.get("href")
        if not common.is_external_link(href, target["self_domains"]):
            continue
        text = common.clean_anchor_text(a.get_text(strip=True))
        if not common.acceptable_name(
            text,
            extra_blocklist=target["name_blocklist"],
            min_len=3,
            max_len=120,
        ):
            continue
        raw.append((text, common.strip_querystring(href or "")))
    # Some pages list sponsors as plain-text inside `<li>` tags without
    # links (BSO often prints anonymous supporters or tier headers).
    # Add any `<li>` or `<p class="sponsor">` whose text passes the
    # name guard, with empty website.
    for sel in ("li", "p.sponsor", "h4.sponsor", "h5.sponsor"):
        for el in soup.select(sel):
            # Skip elements that already have a link we'd have caught.
            if el.find("a", href=True):
                continue
            text = common.clean_anchor_text(el.get_text(strip=True))
            if not common.acceptable_name(
                text,
                extra_blocklist=target["name_blocklist"],
                min_len=4,
                max_len=80,
            ):
                continue
            # Skip plain-text rows that look like dollar amounts or
            # tier brackets ("$10,000+", "Lead Sponsor", etc).
            stripped = text.lower()
            if any(t in stripped for t in (
                "$", "level", "circle", "society", "tier",
                "sponsor:", "donor:", "supporter:", "anonymous",
                "+", "+ above", "or more", "or above",
            )):
                # Allow real names that happen to have these tokens
                # only when they're short — e.g. "Linde Family
                # Foundation" trips on "+" if mis-spaced; most
                # genuine bracket headers are < 20 chars.
                if len(text) < 30:
                    continue
            raw.append((text, ""))
    return common.dedup_keep_first(raw)


# ----------------------------------------------------------------------------
# Row construction
# ----------------------------------------------------------------------------


def _build_row(slug: str, name: str, website: str) -> dict:
    sector = common.infer_sector_from_name(name) or "unknown"
    tag_payload = build_tag_set(
        source=f"{SOURCE_KEY}:{slug}",
        history="program_book_sponsor",
        sector=sector,
        affiliation="unknown",
    )
    return {
        "source": SOURCE_KEY,
        "tier": "A",  # Cultural-anchor sponsors trend to anchor tier;
                       # dedupe can demote if a B/C source disagrees.
        "company_name": name,
        "website": website or None,
        "pipeline_notes": f"corporate_sponsor:{slug}",
        "tags": {k: list(v) for k, v in tag_payload.items()},
    }


def _emit_from_html(slug: str, html: str) -> list[dict]:
    return [_build_row(slug, name, url) for name, url in _parse(slug, html)]


def _scrape_one(slug: str) -> list[dict]:
    target = _TARGETS[slug]
    fixture = common.read_fixture(SOURCE_KEY, slug)
    if fixture is not None:
        return _emit_from_html(slug, fixture)
    common.per_host_sleep(target["url"])
    try:
        html = common.http_get(target["url"])
    except Exception as exc:
        event_log.error(
            "corporate_sponsor_pages_fetch_failed",
            f"{slug} fetch failed: {type(exc).__name__}: {exc}",
            context={"slug": slug, "url": target["url"]},
        )
        return []
    return _emit_from_html(slug, html)


def run_all() -> list[dict]:
    out: list[dict] = []
    for slug in _TARGETS:
        rows = _scrape_one(slug)
        out.extend(rows)
        print(f"[corporate_sponsor_pages] {slug}: {len(rows)} sponsors")
    print(f"[corporate_sponsor_pages] {len(out)} total sponsor rows")
    return out
