"""Stage T6 — ArtsBoston calendar API source.

Plan §8.4 #4. Polls the ArtsBoston events listing and extracts the
``presenter`` (organization producing the event) per event. Each
unique presenter becomes a prospect candidate. Caps at 500 rows per run
initially per plan §8.5; the cap can be relaxed in T8 once
close-rate instrumentation has data.

The ArtsBoston site (`https://www.artsboston.org/`) does not expose a
documented public API — it's a Calendar of Events site. The fetch
target is the public events listing page; we walk presenter names from
event blocks. Vendor parser reliability is medium because the theme
changes regularly; the fixture-based integrity test pins the parser to
a captured snapshot.

Vocab used (all in T1 seed):

* ``operating_model:presenter`` (T1 seed)
* ``operating_model:venue`` (T1 seed) — emitted alongside when the
  presenter doubles as the venue
* ``operating_model:ensemble`` (T1 seed) — fallback for presenters
  without venue/festival semantics
* ``sector:arts,nonprofit``
"""
from __future__ import annotations

from bs4 import BeautifulSoup

from sources import _sponsor_pages_common as common
from util import event_log
from util.tags import build_tag_set

SOURCE_KEY = "artsboston_calendar"

CALENDAR_URL = "https://www.artsboston.org/events/"
SELF_DOMAINS: tuple[str, ...] = ("artsboston.org",)

#: Plan §8.5: cap rows at 500 per run initially.
MAX_ROWS_PER_RUN = 500

#: Names that show up in calendar listings but are obviously not
#: presenters — page nav, filter widgets, ad slots.
_NAME_BLOCKLIST: tuple[str, ...] = (
    "artsboston", "calendar", "events", "filter", "all events",
    "more events", "next page", "previous page",
    "popular dates", "this weekend", "today",
    "featured", "highlighted", "recommended",
)


def _looks_like_venue(name: str) -> bool:
    """Heuristic: presenter name reads like a venue (theatre, hall, museum)."""
    haystack = name.lower()
    return any(
        marker in haystack
        for marker in (
            "theatre", "theater", "hall", "auditorium", "arena",
            "stadium", "gallery", "museum", "library",
            "amphitheater", "amphitheatre", "pavilion",
        )
    )


def _parse(html: str) -> list[tuple[str, str]]:
    """Return ``(presenter, website)`` pairs from one calendar snapshot."""
    soup = BeautifulSoup(html, "html.parser")
    raw: list[tuple[str, str]] = []
    # ArtsBoston uses Jupiter / EventON theme. Each event card carries a
    # `.evo_event_owner` or `.event-presenter` element; if not, the
    # event title itself often contains "presented by X" prose.
    for el in soup.select(".evo_event_owner, .event-presenter, .presenter-name"):
        text = common.clean_anchor_text(el.get_text(strip=True))
        # Strip "Presented by" / "Hosted by" prefixes.
        for prefix in ("presented by ", "hosted by ", "presents: ", "presents "):
            if text.lower().startswith(prefix):
                text = text[len(prefix) :].strip()
        if not common.acceptable_name(
            text,
            extra_blocklist=_NAME_BLOCKLIST,
            max_len=120,
        ):
            continue
        # Optional outbound URL on the same card.
        link = el.find_parent().find("a", href=True) if el.find_parent() else None
        href = link.get("href") if link else None
        if href and not common.is_external_link(href, SELF_DOMAINS):
            href = None
        raw.append((text, common.strip_querystring(href or "")))

    # Fallback: walk event-card anchors for presenter names. ArtsBoston
    # typically links from the event title to the presenter's page.
    if not raw:
        for a in soup.find_all("a", href=True):
            href = a.get("href") or ""
            # Presenter URLs on ArtsBoston live under /organization/<slug>.
            if "/organization/" not in href:
                continue
            text = common.clean_anchor_text(a.get_text(strip=True))
            if not common.acceptable_name(
                text,
                extra_blocklist=_NAME_BLOCKLIST,
                max_len=120,
            ):
                continue
            raw.append((text, common.strip_querystring(href)))
    return common.dedup_keep_first(raw)


def _build_row(name: str, website: str) -> dict:
    op_models: list[str] = ["presenter"]
    if _looks_like_venue(name):
        op_models.append("venue")
    tag_payload = build_tag_set(
        source=SOURCE_KEY,
        operating_model=op_models,
        sector=["arts", "nonprofit"],
        affiliation="unknown",  # let dedupe refine
    )
    return {
        "source": SOURCE_KEY,
        "tier": "A",
        "company_name": name,
        "website": website or None,
        "pipeline_notes": "artsboston_calendar",
        "tags": {k: list(v) for k, v in tag_payload.items()},
    }


def _emit_from_html(html: str) -> list[dict]:
    out: list[dict] = []
    for name, url in _parse(html)[:MAX_ROWS_PER_RUN]:
        out.append(_build_row(name, url))
    return out


def _scrape() -> list[dict]:
    fixture = common.read_fixture(SOURCE_KEY, "calendar")
    if fixture is not None:
        return _emit_from_html(fixture)
    common.per_host_sleep(CALENDAR_URL)
    try:
        html = common.http_get(CALENDAR_URL)
    except Exception as exc:
        event_log.error(
            "artsboston_calendar_fetch_failed",
            f"calendar fetch failed: {type(exc).__name__}: {exc}",
            context={"url": CALENDAR_URL},
        )
        return []
    return _emit_from_html(html)


def run_all() -> list[dict]:
    rows = _scrape()
    print(f"[artsboston_calendar] {len(rows)} presenters (capped {MAX_ROWS_PER_RUN})")
    return rows
