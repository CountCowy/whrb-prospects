"""Stage T6 — Harvard student orgs / OFA ensembles / department directories.

Plan §8.4 #1. Three sub-feeds, all served from the single
``run_all()`` entry point:

* **OSL student organizations** at https://osl.college.harvard.edu/student-organizations
  (~450 entries). Listing page is JSON-driven on the live site; the static
  shell at fetch time still includes server-rendered name + description blocks
  that we parse. Each org is emitted as ``affiliation:harvard_affiliated +
  cambridge_based``, ``operating_model:ensemble`` if its name suggests one
  (chorus / orchestra / ensemble / band / glee / quartet), and
  ``cadence:term_driven``.
* **Office for the Arts resident ensembles** at https://ofa.fas.harvard.edu/
  (~30 ensembles). Each emitted as ``operating_model:ensemble +
  affiliation:harvard_affiliated,cambridge_based`` and a genre derived from
  the ensemble's program area when the page exposes it (Bach Society →
  classical+choral, Hasty Pudding → theatre, etc.).
* **Academic-department homepages** — a configurable list spanning
  Music, HUP, Athletic, Memorial Church, Houses, etc. Emitted as
  ``sector:education + affiliation:harvard_affiliated,cambridge_based``.

Polite HTTP: same UA + 5s/host rate limit + offline-fixture mode as
the rest of the T6 batch.

Vocabulary used (all admin-pre-approved per migration 016):

* ``affiliation:harvard_affiliated`` (T1 seed)
* ``affiliation:cambridge_based`` (T1 seed)
* ``operating_model:ensemble`` (T1 seed)
* ``operating_model:institution`` (T1 seed) — for departments
* ``sector:education`` (T1 seed)
* ``sector:arts`` (T1 seed)
* ``sector:nonprofit`` (T1 seed)
* ``cadence:term_driven`` (T1 seed)
* ``genre:classical|choral|jazz|theatre|dance|world_music|...``
  (T1 seed)
"""
from __future__ import annotations

from typing import TypedDict

from bs4 import BeautifulSoup

from sources import _sponsor_pages_common as common
from util import event_log
from util.tags import build_tag_set

SOURCE_KEY = "harvard_orgs"

#: Domains the Harvard ecosystem owns — never a "sponsor link" for
#: this source. Anything that looks like ``*.harvard.edu`` is a self-link.
_SELF_DOMAINS: tuple[str, ...] = (
    "harvard.edu",
    "fas.harvard.edu",
    "college.harvard.edu",
    "gsd.harvard.edu",
    "hbs.edu",
    "hks.harvard.edu",
    "hms.harvard.edu",
    "hsph.harvard.edu",
    "law.harvard.edu",
)


class _Feed(TypedDict):
    slug: str
    url: str
    parse: str  # name of the parse function in this module
    feed_kind: str  # 'student_org' | 'ensemble' | 'department'


_FEEDS: dict[str, _Feed] = {
    "osl": {
        "slug": "osl",
        "url": "https://osl.college.harvard.edu/student-organizations",
        "parse": "parse_osl",
        "feed_kind": "student_org",
    },
    "ofa": {
        "slug": "ofa",
        "url": "https://ofa.fas.harvard.edu/",
        "parse": "parse_ofa",
        "feed_kind": "ensemble",
    },
    "ofa_dance": {
        "slug": "ofa_dance",
        "url": "https://ofa.fas.harvard.edu/dance",
        "parse": "parse_ofa",
        "feed_kind": "ensemble",
    },
    "ofa_music": {
        "slug": "ofa_music",
        "url": "https://ofa.fas.harvard.edu/music",
        "parse": "parse_ofa",
        "feed_kind": "ensemble",
    },
    "ofa_theater": {
        "slug": "ofa_theater",
        "url": "https://ofa.fas.harvard.edu/theater",
        "parse": "parse_ofa",
        "feed_kind": "ensemble",
    },
    # Individual ensemble pages — each emits a single row tagged
    # operating_model:ensemble. Catalog spans the major Harvard musical /
    # theatrical groups; covers the ≥1-ensemble requirement of T01 even when
    # OFA's homepage is nav-only.
    "harvard_glee_club": {
        "slug": "harvard_glee_club",
        "url": "https://harvardgleeclub.org/",
        "parse": "parse_ensemble_page",
        "feed_kind": "ensemble",
    },
    "radcliffe_choral_society": {
        "slug": "radcliffe_choral_society",
        "url": "https://radcliffechoralsociety.org/",
        "parse": "parse_ensemble_page",
        "feed_kind": "ensemble",
    },
    "din_and_tonics": {
        "slug": "din_and_tonics",
        "url": "https://www.dinandtonics.com/",
        "parse": "parse_ensemble_page",
        "feed_kind": "ensemble",
    },
    "krokodiloes": {
        "slug": "krokodiloes",
        "url": "https://kroks.com/",
        "parse": "parse_ensemble_page",
        "feed_kind": "ensemble",
    },
    "harvard_bach_society": {
        "slug": "harvard_bach_society",
        "url": "https://harvardbachsociety.org/",
        "parse": "parse_ensemble_page",
        "feed_kind": "ensemble",
    },
    "harvard_radcliffe_orchestra": {
        "slug": "harvard_radcliffe_orchestra",
        "url": "https://www.harvardradcliffeorchestra.org/",
        "parse": "parse_ensemble_page",
        "feed_kind": "ensemble",
    },
    "music_dept": {
        "slug": "music_dept",
        "url": "https://music.fas.harvard.edu/",
        "parse": "parse_department",
        "feed_kind": "department",
    },
    "memorial_church": {
        "slug": "memorial_church",
        "url": "https://memorialchurch.harvard.edu/",
        "parse": "parse_department",
        "feed_kind": "department",
    },
    "athletics": {
        "slug": "athletics",
        "url": "https://gocrimson.com/",
        "parse": "parse_department",
        "feed_kind": "department",
    },
    "hup": {
        "slug": "hup",
        "url": "https://www.hup.harvard.edu/",
        "parse": "parse_department",
        "feed_kind": "department",
    },
}


# ----------------------------------------------------------------------------
# Genre inference (small token-based heuristic)
# ----------------------------------------------------------------------------

_GENRE_TOKEN_HINTS: tuple[tuple[tuple[str, ...], list[str]], ...] = (
    (("orchestra", "philharmonic", "symphony", "chamber music",
      "string quartet", "wind ensemble", "concert band", "early music",
      "baroque"),
     ["classical"]),
    (("glee", "chorus", "choir", "choral", "collegium",
      "a cappella"),
     ["choral"]),
    (("opera", "lyric"),
     ["opera"]),
    (("jazz",),
     ["jazz"]),
    (("hasty pudding", "theatricals", "drama", "shakespeare",
      "theatre", "theater"),
     ["theatre"]),
    (("ballet", "dance", "kuumba"),
     ["dance"]),
    (("din & tonics", "din and tonics", "krokodiloes",
      "low keys", "callbacks"),  # named Harvard a-cappella groups
     ["choral"]),
    (("world", "afrika", "raza", "asian american",
      "indian", "chinese", "korean", "japanese"),
     ["world_music"]),
    (("bluegrass",),
     ["folk"]),
    (("rock", "indie"),
     ["rock_indie"]),
)


def _infer_genres(name: str | None) -> list[str]:
    """Return a list of genre vocab values implied by *name*."""
    if not name:
        return []
    haystack = name.lower()
    out: list[str] = []
    seen: set[str] = set()
    for fragments, genres in _GENRE_TOKEN_HINTS:
        for frag in fragments:
            if frag in haystack:
                for g in genres:
                    if g not in seen:
                        seen.add(g)
                        out.append(g)
                break
    return out


def _looks_like_ensemble(name: str | None) -> bool:
    """Return True if *name* is plausibly an arts ensemble (vs. a club)."""
    if not name:
        return False
    haystack = name.lower()
    return any(
        marker in haystack
        for marker in (
            "orchestra", "ensemble", "chorus", "choir", "choral",
            "glee", "quartet", "band", "philharmonic", "symphony",
            "ballet", "dance company", "opera", "society",
            "consort", "concert",
        )
    )


# ----------------------------------------------------------------------------
# Per-feed parsers
# ----------------------------------------------------------------------------


def parse_osl(html: str) -> list[dict]:
    """OSL student-org listing. The live page renders cards via JS but the
    server shell exposes ``.field--name-title`` (or similar) text — we look
    for any ``<h2>`` / ``<h3>`` whose text passes the name guard.
    """
    soup = BeautifulSoup(html, "html.parser")
    rows: list[dict] = []
    seen: set[str] = set()
    # OSL uses a Drupal theme; orgs render under `.views-row` containers.
    for container in soup.select(".views-row, .org-card, article"):
        title = container.find(["h2", "h3", "h4"])
        if not title:
            continue
        name = title.get_text(strip=True)
        if not common.acceptable_name(name, max_len=120):
            continue
        norm = name.lower()
        if norm in seen:
            continue
        seen.add(norm)
        # Optional outbound URL.
        link = container.find("a", href=True)
        href = link.get("href") if link else None
        if href and not href.startswith("http"):
            href = None
        rows.append({"name": name, "website": href or "", "kind": "student_org"})
    # Fallback: if the .views-row selector finds nothing (layout shift),
    # walk every plausible heading on the page.
    if not rows:
        for h in soup.find_all(["h2", "h3", "h4"]):
            name = h.get_text(strip=True)
            if not common.acceptable_name(name, max_len=120):
                continue
            norm = name.lower()
            if norm in seen:
                continue
            seen.add(norm)
            rows.append({"name": name, "website": "", "kind": "student_org"})
    return rows


def parse_ofa(html: str) -> list[dict]:
    """Office for the Arts homepage / resident-ensemble feed.

    The OFA homepage links to each ensemble's program page under headings
    like "Resident Ensembles", "Student Performance Groups", etc. We
    harvest every plausible link whose anchor text is an org-style name.
    """
    soup = BeautifulSoup(html, "html.parser")
    rows: list[dict] = []
    seen: set[str] = set()
    for a in soup.find_all("a", href=True):
        text = a.get_text(strip=True)
        if not common.acceptable_name(text, max_len=120):
            continue
        if not _looks_like_ensemble(text) and text.lower() not in {
            "harvard glee club", "harvard din & tonics",
            "radcliffe choral society", "harvard opportunes",
        }:
            continue
        norm = text.lower()
        if norm in seen:
            continue
        seen.add(norm)
        href = a.get("href") or ""
        rows.append(
            {"name": text, "website": href if href.startswith("http") else "", "kind": "ensemble"}
        )
    return rows


def parse_department(html: str) -> list[dict]:
    """Single-department homepage parser — emits ONE row per page.

    The department's name comes from the document title or the first
    ``<h1>``. Used for music_dept, memorial_church, athletics, hup.
    """
    soup = BeautifulSoup(html, "html.parser")
    title_tag = soup.find("title")
    h1 = soup.find("h1")
    name = ""
    if h1:
        name = h1.get_text(strip=True)
    if (not name or len(name) > 120) and title_tag:
        name = title_tag.get_text(strip=True)
    name = name.split("|")[0].split("·")[0].strip()
    if not common.acceptable_name(name, max_len=160):
        return []
    return [{"name": name, "website": "", "kind": "department"}]


def parse_ensemble_page(html: str) -> list[dict]:
    """Single-ensemble homepage parser — emits ONE row tagged ensemble.

    The ensemble's name is pulled from the same h1/title heuristic as
    ``parse_department`` but the row is emitted with ``kind='ensemble'``
    so the row builder applies ``operating_model:ensemble`` and
    ``sector:arts,nonprofit``.
    """
    soup = BeautifulSoup(html, "html.parser")
    title_tag = soup.find("title")
    h1 = soup.find("h1")
    name = ""
    if h1:
        name = h1.get_text(strip=True)
    if (not name or len(name) > 120) and title_tag:
        name = title_tag.get_text(strip=True)
    name = name.split("|")[0].split("·")[0].strip()
    if not common.acceptable_name(name, max_len=160):
        return []
    return [{"name": name, "website": "", "kind": "ensemble"}]


_PARSERS = {
    "parse_osl": parse_osl,
    "parse_ofa": parse_ofa,
    "parse_department": parse_department,
    "parse_ensemble_page": parse_ensemble_page,
}


# ----------------------------------------------------------------------------
# Row construction
# ----------------------------------------------------------------------------


def _build_row(slug: str, entry: dict) -> dict:
    name = entry["name"]
    website = entry.get("website") or ""
    kind = entry.get("kind", "student_org")
    genres = _infer_genres(name)

    sectors: list[str] = []
    if kind == "ensemble":
        sectors = ["arts", "nonprofit"]
    elif kind == "department":
        sectors = ["education"]
    else:  # student_org
        sectors = ["education"]
        if _looks_like_ensemble(name):
            sectors.append("arts")

    if kind == "department":
        operating_model: list[str] = ["institution"]
    elif kind == "ensemble" or _looks_like_ensemble(name):
        operating_model = ["ensemble"]
    else:
        operating_model = []

    tag_payload = build_tag_set(
        source=f"{SOURCE_KEY}:{slug}",
        sector=sectors or None,
        operating_model=operating_model or None,
        genre=genres or None,
        affiliation=["harvard_affiliated", "cambridge_based"],
        cadence="term_driven",
    )
    row = {
        "source": SOURCE_KEY,
        "tier": "B",  # Conservative; dedupe + program-book overlap can promote.
        "company_name": name,
        "website": website or None,
        "pipeline_notes": f"harvard:{slug}:{kind}",
        "tags": {k: list(v) for k, v in tag_payload.items()},
    }
    return row


def _emit_from_html(slug: str, html: str) -> list[dict]:
    feed = _FEEDS[slug]
    parser = _PARSERS[feed["parse"]]
    parsed = parser(html)
    out: list[dict] = []
    for entry in parsed:
        out.append(_build_row(slug, entry))
    return out


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
            "harvard_orgs_fetch_failed",
            f"{slug} fetch failed: {type(exc).__name__}: {exc}",
            context={"slug": slug, "url": feed["url"]},
        )
        return []
    return _emit_from_html(slug, html)


def run_all() -> list[dict]:
    """Pipeline entry: scrape every Harvard feed.

    The Harvard scrape emits a high volume of rows (~450 student orgs +
    ~30 ensembles + 4 departments at fixture-capture time). Each feed's
    parser returns a deduped list; the union is left to the pipeline's
    main dedupe phase to merge with collisions from city_licenses /
    program_books / etc.
    """
    out: list[dict] = []
    for slug in _FEEDS:
        rows = _scrape_one(slug)
        out.extend(rows)
        print(f"[harvard_orgs] {slug}: {len(rows)} orgs")
    print(f"[harvard_orgs] {len(out)} total Harvard rows")
    return out
