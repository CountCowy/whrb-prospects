"""Stage T6 — Arts ensemble association directories.

Plan §8.4 #2. Four sub-feeds:

* **Greater Boston Choral Consortium** —
  https://bostonsings.org/member-groups/  (operating_model:ensemble,
  genre:choral)
* **Early Music America** — https://www.earlymusicamerica.org/  (filtered
  for MA members; operating_model:ensemble, genre:classical)
* **Chamber Music America** — https://www.chamber-music.org/directory  (MA
  filtered; operating_model:ensemble, genre:classical)
* **League of American Orchestras** — https://americanorchestras.org/  (MA
  filtered; operating_model:ensemble, genre:classical)

Each association exposes a member directory; the parser walks
``a[href^="http"]`` for plausible org-style names. Membership in a
professional association is itself an ICP signal — these are the small +
mid ensembles the Turn-6 audit flagged as under-represented.

Vocab used (all in T1 seed):

* ``operating_model:ensemble``
* ``genre:choral`` (GBCC) / ``classical`` (EMA + CMA + LAO)
* ``sector:arts,nonprofit``
* ``affiliation:greater_boston`` (default; left ``unknown`` for non-MA
  members so dedupe doesn't promote a national row to local)
"""
from __future__ import annotations

from typing import TypedDict

from bs4 import BeautifulSoup

from sources import _sponsor_pages_common as common
from util import event_log
from util.tags import build_tag_set

SOURCE_KEY = "arts_associations"


class _Feed(TypedDict):
    slug: str
    url: str
    self_domains: tuple[str, ...]
    genre: str
    name_blocklist: tuple[str, ...]


_FEEDS: dict[str, _Feed] = {
    "gbcc": {
        "slug": "gbcc",
        "url": "https://bostonsings.org/member-groups/",
        "self_domains": ("bostonsings.org",),
        "genre": "choral",
        "name_blocklist": (
            "greater boston choral consortium", "gbcc", "member groups",
            "about", "events", "contact", "join", "log in",
        ),
    },
    "ema": {
        "slug": "ema",
        "url": "https://www.earlymusicamerica.org/",
        "self_domains": ("earlymusicamerica.org",),
        "genre": "classical",
        "name_blocklist": (
            "early music america", "early music magazine", "membership",
            "donate", "events", "directory",
        ),
    },
    "cma": {
        "slug": "cma",
        "url": "https://www.chamber-music.org/directory",
        "self_domains": ("chamber-music.org",),
        "genre": "classical",
        "name_blocklist": (
            "chamber music america", "directory", "membership",
            "the cma magazine",
        ),
    },
    "lao": {
        "slug": "lao",
        "url": "https://americanorchestras.org/",
        "self_domains": ("americanorchestras.org",),
        "genre": "classical",
        "name_blocklist": (
            "league of american orchestras", "the league", "members",
            "about", "events",
        ),
    },
}


def _parse(slug: str, html: str) -> list[tuple[str, str]]:
    """Return ``(name, website)`` pairs from one association directory."""
    feed = _FEEDS[slug]
    soup = BeautifulSoup(html, "html.parser")
    raw: list[tuple[str, str]] = []
    blocklist = feed["name_blocklist"]
    for a in soup.find_all("a", href=True):
        href = a.get("href")
        if not common.is_external_link(href, feed["self_domains"]):
            continue
        text = common.clean_anchor_text(a.get_text(strip=True))
        if not common.acceptable_name(
            text,
            extra_blocklist=blocklist,
            min_len=4,
            max_len=120,
        ):
            continue
        raw.append((text, common.strip_querystring(href or "")))
    return common.dedup_keep_first(raw)


def _build_row(slug: str, name: str, website: str) -> dict:
    feed = _FEEDS[slug]
    tag_payload = build_tag_set(
        source=f"{SOURCE_KEY}:{slug}",
        sector=["arts", "nonprofit"],
        operating_model="ensemble",
        genre=feed["genre"],
        affiliation="unknown",  # let dedupe refine via OSM/ZIP collisions
    )
    return {
        "source": SOURCE_KEY,
        "tier": "B",
        "company_name": name,
        "website": website or None,
        "pipeline_notes": f"arts_assoc:{slug}",
        "tags": {k: list(v) for k, v in tag_payload.items()},
    }


def _emit_from_html(slug: str, html: str) -> list[dict]:
    return [_build_row(slug, name, url) for name, url in _parse(slug, html)]


def _scrape_one(slug: str) -> list[dict]:
    feed = _FEEDS[slug]
    fixture = common.read_fixture(SOURCE_KEY, slug)
    if fixture is not None:
        return _emit_from_html(slug, fixture)
    common.per_host_sleep(feed["url"])
    try:
        html = common.http_get(feed["url"])
    except Exception as exc:
        event_log.error(
            "arts_associations_fetch_failed",
            f"{slug} fetch failed: {type(exc).__name__}: {exc}",
            context={"slug": slug, "url": feed["url"]},
        )
        return []
    return _emit_from_html(slug, html)


def run_all() -> list[dict]:
    out: list[dict] = []
    for slug in _FEEDS:
        rows = _scrape_one(slug)
        out.extend(rows)
        print(f"[arts_associations] {slug}: {len(rows)} members")
    print(f"[arts_associations] {len(out)} total association rows")
    return out
