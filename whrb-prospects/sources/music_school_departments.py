"""Stage T6 — Music school + sister-institution department directories.

Plan §8.4 #6. Six institution groups, each scraping its public homepage
and (optionally) a department directory:

* MIT — DAPER, Music & Theater Arts, Sloan ExecEd
* Berklee — flagship + Concert Operations
* New England Conservatory — flagship + departments
* Longy School of Music — flagship
* Boston University — College of Fine Arts + Questrom
* Yale — School of Music (touring-ensemble directory)

Each emitted row gets ``affiliation:<institution>_affiliated`` (per
migration 016) plus ``sector:education`` and
``operating_model:institution``. Per-institution genre tags are NOT
emitted from this source — those are layered on by the program-book
sponsor source or by manual edits.

Vocab used:

* ``affiliation:mit_affiliated`` (T1 seed)
* ``affiliation:berklee_affiliated`` (migration 016)
* ``affiliation:nec_affiliated`` (migration 016)
* ``affiliation:longy_affiliated`` (migration 016)
* ``affiliation:bu_affiliated`` (migration 016)
* ``affiliation:yale_affiliated`` (migration 016)
* ``affiliation:cambridge_based`` / ``boston_based`` /
  ``new_england_regional`` — secondary geographic affiliation per
  institution (T1 seed)
* ``sector:education`` (T1 seed)
* ``operating_model:institution`` (T1 seed)
"""
from __future__ import annotations

from typing import TypedDict

from bs4 import BeautifulSoup

from sources import _sponsor_pages_common as common
from util import event_log
from util.tags import build_tag_set

SOURCE_KEY = "music_school_departments"


class _Institution(TypedDict):
    slug: str
    display_name: str
    url: str
    self_domains: tuple[str, ...]
    primary_affiliation: str  # the migration-016 vocab value
    geo_affiliation: str  # secondary cambridge_based / boston_based / etc.
    name_blocklist: tuple[str, ...]


_INSTITUTIONS: dict[str, _Institution] = {
    "mit_main": {
        "slug": "mit_main",
        "display_name": "Massachusetts Institute of Technology",
        "url": "https://www.mit.edu/",
        "self_domains": ("mit.edu",),
        "primary_affiliation": "mit_affiliated",
        "geo_affiliation": "cambridge_based",
        "name_blocklist": (
            "massachusetts institute of technology", "mit",
            "mit news", "mit admissions", "mit alumni",
        ),
    },
    "mit_music": {
        "slug": "mit_music",
        "display_name": "MIT Music and Theater Arts",
        "url": "https://mta.mit.edu/",
        "self_domains": ("mit.edu", "mta.mit.edu"),
        "primary_affiliation": "mit_affiliated",
        "geo_affiliation": "cambridge_based",
        "name_blocklist": (
            "music and theater arts", "mta", "mit music",
            "department of music", "school of humanities arts",
        ),
    },
    "berklee_main": {
        "slug": "berklee_main",
        "display_name": "Berklee College of Music",
        "url": "https://www.berklee.edu/",
        "self_domains": ("berklee.edu",),
        "primary_affiliation": "berklee_affiliated",
        "geo_affiliation": "boston_based",
        "name_blocklist": (
            "berklee", "berklee college of music",
            "berklee online", "berklee press",
        ),
    },
    "nec_main": {
        "slug": "nec_main",
        "display_name": "New England Conservatory",
        "url": "https://necmusic.edu/",
        "self_domains": ("necmusic.edu",),
        "primary_affiliation": "nec_affiliated",
        "geo_affiliation": "boston_based",
        "name_blocklist": (
            "new england conservatory", "nec",
            "necmusic", "jordan hall",
        ),
    },
    "longy_main": {
        "slug": "longy_main",
        "display_name": "Longy School of Music",
        "url": "https://longy.edu/",
        "self_domains": ("longy.edu",),
        "primary_affiliation": "longy_affiliated",
        "geo_affiliation": "cambridge_based",
        "name_blocklist": (
            "longy", "longy school of music",
            "longy school of music of bard college",
        ),
    },
    "bu_cfa": {
        "slug": "bu_cfa",
        "display_name": "Boston University College of Fine Arts",
        "url": "https://www.bu.edu/cfa/",
        "self_domains": ("bu.edu",),
        "primary_affiliation": "bu_affiliated",
        "geo_affiliation": "boston_based",
        "name_blocklist": (
            "boston university", "bu", "college of fine arts",
            "cfa", "school of music",
        ),
    },
    "bu_questrom": {
        "slug": "bu_questrom",
        "display_name": "Boston University Questrom School of Business",
        "url": "https://www.bu.edu/questrom/",
        "self_domains": ("bu.edu",),
        "primary_affiliation": "bu_affiliated",
        "geo_affiliation": "boston_based",
        "name_blocklist": (
            "questrom", "questrom school of business",
            "boston university", "bu",
        ),
    },
    "yale_music": {
        "slug": "yale_music",
        "display_name": "Yale School of Music",
        "url": "https://music.yale.edu/",
        "self_domains": ("yale.edu",),
        "primary_affiliation": "yale_affiliated",
        "geo_affiliation": "new_england_regional",
        "name_blocklist": (
            "yale", "yale school of music", "yale university",
            "school of music",
        ),
    },
}


def _parse(slug: str, html: str) -> dict:
    """Return a single ``{"name": ..., "website": ...}`` describing the
    institution itself.

    These are entrypoints — we don't try to harvest every individual
    department from each homepage (that would explode the row count and
    pollute the prospect list with internal Harvard/MIT URLs that are
    not viable ad-sales targets). We always emit the manifest's
    ``display_name`` so the DB stores the canonical institution name
    even when the live homepage's h1/title is shorter or branded
    (e.g. Berklee's homepage h1 is just "Berklee" but the canonical
    name is "Berklee College of Music"). The HTML is parsed only as a
    health check: an unparseable response surfaces in event_log via
    the upstream fetcher.
    """
    inst = _INSTITUTIONS[slug]
    # Touch the HTML so any malformed-document exception surfaces, but
    # ignore the parsed candidate — display_name is authoritative.
    if html:
        BeautifulSoup(html, "html.parser")
    return {"name": inst["display_name"], "website": inst["url"]}


def _build_row(slug: str, name: str, website: str) -> dict:
    inst = _INSTITUTIONS[slug]
    affiliations = [inst["primary_affiliation"], inst["geo_affiliation"]]
    tag_payload = build_tag_set(
        source=f"{SOURCE_KEY}:{slug}",
        sector="education",
        operating_model="institution",
        affiliation=affiliations,
        cadence="term_driven",
    )
    return {
        "source": SOURCE_KEY,
        "tier": "A",  # Institutional anchors trend to anchor-tier sponsorship
                       # opportunities — although the institution itself is
                       # rarely the buyer (their executive education / extension
                       # arms are).
        "company_name": name,
        "website": website,
        "pipeline_notes": f"music_school:{slug}",
        "tags": {k: list(v) for k, v in tag_payload.items()},
    }


def _emit_from_html(slug: str, html: str) -> list[dict]:
    entry = _parse(slug, html)
    return [_build_row(slug, entry["name"], entry["website"])]


def _scrape_one(slug: str) -> list[dict]:
    inst = _INSTITUTIONS[slug]
    fixture = common.read_fixture(SOURCE_KEY, slug)
    if fixture is not None:
        return _emit_from_html(slug, fixture)
    common.per_host_sleep(inst["url"])
    try:
        html = common.http_get(inst["url"])
    except Exception as exc:
        event_log.error(
            "music_school_departments_fetch_failed",
            f"{slug} fetch failed: {type(exc).__name__}: {exc}",
            context={"slug": slug, "url": inst["url"]},
        )
        # Still emit the institution itself on fetch failure.
        return [_build_row(slug, inst["display_name"], inst["url"])]
    return _emit_from_html(slug, html)


def run_all() -> list[dict]:
    out: list[dict] = []
    for slug in _INSTITUTIONS:
        rows = _scrape_one(slug)
        out.extend(rows)
        print(f"[music_school_departments] {slug}: {len(rows)} rows")
    print(f"[music_school_departments] {len(out)} total institution rows")
    return out
