"""Stage T6 — Church concert series scraper.

Plan §8.4 #5. Each church publishes a concert / music-program page; we
scrape that page for the church's own name (a single ICP-aligned row
per venue) and harvest any external links to ensembles in residence /
visiting programs (those become additional rows tagged
``operating_model:ensemble``, ``sector:arts,nonprofit``).

The dedupe value here is ``operating_model:venue,presenter`` inheritance
— if Trinity Church Copley appears in three different sources (city
licenses, OSM, here) they merge into one prospect with all three
provenance entries on the comma-list ``source`` column.

Vocab used (all in T1 seed):

* ``operating_model:venue`` (T1 seed)
* ``operating_model:presenter`` (T1 seed)
* ``operating_model:ensemble`` (T1 seed) — for cross-listed groups
* ``sector:religious`` (T1 seed)
* ``sector:arts,nonprofit`` (T1 seed)
* ``affiliation`` derived from ZIP via :func:`util.tags.affiliation_for_zip`
"""
from __future__ import annotations

from typing import TypedDict

from bs4 import BeautifulSoup

from sources import _sponsor_pages_common as common
from util import event_log
from util.tags import affiliation_for_zip, build_tag_set

SOURCE_KEY = "church_concerts"


class _Venue(TypedDict):
    slug: str
    display_name: str
    url: str
    self_domains: tuple[str, ...]
    zip: str
    name_blocklist: tuple[str, ...]


_VENUES: dict[str, _Venue] = {
    "kings_chapel": {
        "slug": "kings_chapel",
        "display_name": "King's Chapel",
        "url": "https://www.kings-chapel.org/music",
        "self_domains": ("kings-chapel.org",),
        "zip": "02108",
        "name_blocklist": (
            "kings chapel", "king's chapel",
            "concerts at kings chapel", "concerts at king's chapel",
            "music director", "concert series",
        ),
    },
    "trinity_copley": {
        "slug": "trinity_copley",
        "display_name": "Trinity Church Boston",
        "url": "https://www.trinitychurchboston.org/music",
        "self_domains": ("trinitychurchboston.org",),
        "zip": "02116",
        "name_blocklist": (
            "trinity church", "trinity copley", "trinity boston",
            "music ministry", "trinity choir",
        ),
    },
    "old_south": {
        "slug": "old_south",
        "display_name": "Old South Church",
        "url": "https://www.oldsouth.org/music",
        "self_domains": ("oldsouth.org",),
        "zip": "02116",
        "name_blocklist": (
            "old south church", "old south", "music & arts",
            "music and arts", "minister of music",
        ),
    },
    "first_lutheran_boston": {
        "slug": "first_lutheran_boston",
        "display_name": "First Lutheran Church of Boston",
        "url": "https://www.flc-boston.org/bach-vespers",
        "self_domains": ("flc-boston.org",),
        "zip": "02116",
        "name_blocklist": (
            "first lutheran", "flc", "bach vespers",
            "bach institute",
        ),
    },
    "first_baptist_medford": {
        "slug": "first_baptist_medford",
        "display_name": "First Baptist Church of Medford",
        "url": "https://firstbaptistmedford.org/concerts",
        "self_domains": ("firstbaptistmedford.org",),
        "zip": "02155",
        "name_blocklist": (
            "first baptist", "fbc medford", "concerts",
        ),
    },
    "christ_church_cambridge": {
        "slug": "christ_church_cambridge",
        "display_name": "Christ Church Cambridge",
        "url": "https://www.cccambridge.org/music",
        "self_domains": ("cccambridge.org",),
        "zip": "02138",
        "name_blocklist": (
            "christ church", "cambridge", "music ministry",
        ),
    },
    "st_pauls_harvard_sq": {
        "slug": "st_pauls_harvard_sq",
        "display_name": "St. Paul's Harvard Square",
        # Domain change in 2024-2025: stpaulparish.org now 301-redirects to
        # stpaulsharvardsquare.org. The new host is canonical; the old
        # `/music` path returned 404 in run deebeff6.
        "url": "https://www.stpaulsharvardsquare.org/music",
        "self_domains": ("stpaulsharvardsquare.org", "stpaulparish.org"),
        "zip": "02138",
        "name_blocklist": (
            "st paul", "st. paul", "saint paul",
            "harvard square", "music",
        ),
    },
    "advent_beacon_hill": {
        "slug": "advent_beacon_hill",
        "display_name": "Church of the Advent",
        "url": "https://www.theadventboston.org/music",
        "self_domains": ("theadventboston.org",),
        "zip": "02114",
        "name_blocklist": (
            "church of the advent", "the advent",
            "music program", "advent choir",
        ),
    },
    "methuen_memorial": {
        "slug": "methuen_memorial",
        "display_name": "Methuen Memorial Music Hall",
        "url": "https://www.mmmh.org/",
        "self_domains": ("mmmh.org",),
        "zip": "01844",
        "name_blocklist": (
            "methuen memorial music hall", "music hall", "mmmh",
            "concert series", "season", "tickets",
        ),
    },
}


def _parse(slug: str, html: str) -> tuple[dict, list[dict]]:
    """Return ``(venue_row, [ensemble_rows...])`` from one venue page.

    The first element is the venue itself (always emitted; if the page
    fails to parse anything else we still get one row per church). The
    second is any cross-listed ensembles harvested from external links.
    """
    venue = _VENUES[slug]
    soup = BeautifulSoup(html, "html.parser")
    ensembles: list[dict] = []
    for a in soup.find_all("a", href=True):
        href = a.get("href")
        if not common.is_external_link(href, venue["self_domains"]):
            continue
        text = common.clean_anchor_text(a.get_text(strip=True))
        if not common.acceptable_name(
            text,
            extra_blocklist=venue["name_blocklist"],
            min_len=4,
            max_len=120,
        ):
            continue
        ensembles.append(
            {
                "name": text,
                "website": common.strip_querystring(href or ""),
            }
        )
    venue_row = {"name": venue["display_name"], "website": ""}
    return venue_row, common.dedup_keep_first(
        [(e["name"], e["website"]) for e in ensembles]
    )


def _build_venue_row(slug: str, name: str) -> dict:
    venue = _VENUES[slug]
    affiliation = affiliation_for_zip(venue["zip"])
    aff_kwarg = affiliation if affiliation else "unknown"
    tag_payload = build_tag_set(
        source=f"{SOURCE_KEY}:{slug}",
        sector=["religious", "arts", "nonprofit"],
        operating_model=["venue", "presenter"],
        affiliation=aff_kwarg,
    )
    return {
        "source": SOURCE_KEY,
        "tier": "B",
        "company_name": name,
        "website": venue["url"],
        "zip": venue["zip"],
        "pipeline_notes": f"church_venue:{slug}",
        "tags": {k: list(v) for k, v in tag_payload.items()},
    }


def _build_ensemble_row(slug: str, name: str, website: str) -> dict:
    tag_payload = build_tag_set(
        source=f"{SOURCE_KEY}:{slug}",
        sector=["arts", "nonprofit"],
        operating_model="ensemble",
        affiliation="unknown",  # let dedupe refine
    )
    return {
        "source": SOURCE_KEY,
        "tier": "B",
        "company_name": name,
        "website": website or None,
        "pipeline_notes": f"church_ensemble:{slug}",
        "tags": {k: list(v) for k, v in tag_payload.items()},
    }


def _emit_from_html(slug: str, html: str) -> list[dict]:
    venue_row, ensembles = _parse(slug, html)
    out = [_build_venue_row(slug, venue_row["name"])]
    for name, website in [(e[0], e[1]) for e in ensembles]:
        out.append(_build_ensemble_row(slug, name, website))
    return out


def _scrape_one(slug: str) -> list[dict]:
    venue = _VENUES[slug]
    fixture = common.read_fixture(SOURCE_KEY, slug)
    if fixture is not None:
        return _emit_from_html(slug, fixture)
    common.per_host_sleep(venue["url"])
    try:
        html = common.http_get(venue["url"])
    except Exception as exc:
        event_log.error(
            "church_concerts_fetch_failed",
            f"{slug} fetch failed: {type(exc).__name__}: {exc}",
            context={"slug": slug, "url": venue["url"]},
        )
        # Still emit the venue itself even on fetch failure — its name +
        # zip are static enough that a single venue row is worth preserving.
        return [_build_venue_row(slug, venue["display_name"])]
    return _emit_from_html(slug, html)


def run_all() -> list[dict]:
    out: list[dict] = []
    for slug in _VENUES:
        rows = _scrape_one(slug)
        out.extend(rows)
        print(f"[church_concerts] {slug}: {len(rows)} rows (incl. venue + ensembles)")
    print(f"[church_concerts] {len(out)} total rows")
    return out
