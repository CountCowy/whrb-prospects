"""Tag-emitter helpers for pipeline sources (Stage T2).

Every source module calls :func:`build_tag_set` when constructing a row dict
and stuffs the result under ``row['tags']``. The pipeline serialises that
payload into per-axis CSV columns and later into ``prospect_tags`` rows.

Vocab conformance is enforced at emit time:

* **Strict mode** (``WHRB_VOCAB_STRICT=true``, the module default) —
  ``build_tag_set`` raises :class:`UnknownVocabError` on any
  ``(axis, value)`` pair that isn't in :data:`VALID_VOCAB`. This is the dev
  + CI mode: emitter typos surface during ``pytest`` and in local runs
  rather than in prod.
* **Lax mode** (``WHRB_VOCAB_STRICT=false``) — unknown values fall back
  to ``{axis}:unknown`` and emit a ``tag_vocab_miss`` warn event for the
  admin log. Intended for prod, where a scraper adding a genre WHRB
  hasn't vocab-approved yet should not page an engineer.

Vocab is loaded once per process from :data:`public.tag_vocabulary` (active
rows only). The in-process cache is keyed by axis→set of values. If the
Supabase client can't be initialized (no creds), the cache seeds from
:data:`seed_tags.sql`'s canonical list via a hard-coded fallback so unit
tests and ``--no-supabase`` runs still work.

ZIP → affiliation mapping (``affiliation_for_zip``) covers the five metro
values from the plan's §1.3 #4 locked-decision. Harvard/MIT affiliation is
not derivable from ZIP alone — those tags come from the T6 Harvard/MIT
source modules.
"""
from __future__ import annotations

import os
import threading
from typing import Literal

from util import event_log

# -------------------------------------------------------------------------
# Types + constants
# -------------------------------------------------------------------------

AXES = Literal[
    "sector",
    "operating_model",
    "genre",
    "affiliation",
    "cadence",
    "daypart_fit",
    "history",
    "compliance",
    "other",
]

_VALID_AXES: tuple[str, ...] = (
    "sector",
    "operating_model",
    "genre",
    "affiliation",
    "cadence",
    "daypart_fit",
    "history",
    "compliance",
    "other",
)


class UnknownVocabError(ValueError):
    """Raised in strict mode when ``build_tag_set`` sees an unknown value."""


# -------------------------------------------------------------------------
# Strict / lax mode toggle
# -------------------------------------------------------------------------

def _strict_default() -> bool:
    """Read ``WHRB_VOCAB_STRICT`` env var. Default true (dev + CI).

    Set to ``"false"`` / ``"0"`` / ``"no"`` in prod to fall back silently
    with a log event. Any unrecognised value is treated as strict.
    """
    raw = os.environ.get("WHRB_VOCAB_STRICT", "true").strip().lower()
    return raw not in {"false", "0", "no", "off"}


# -------------------------------------------------------------------------
# Canonical-vocab fallback (mirrors seed_tags.sql)
# -------------------------------------------------------------------------
#
# Used when the DB isn't reachable (e.g. --no-supabase or pytest). Keep in
# sync with whrb-web/supabase/seed_tags.sql (TAGS.md is single source of
# truth but Python can't parse a markdown table at import time).

_SEED_VOCAB: dict[str, set[str]] = {
    "sector": {
        "unknown", "arts", "nonprofit", "education", "home_services",
        "religious", "finance", "medical", "retail", "technology",
        "hospitality", "real_estate",
    },
    "operating_model": {
        "unknown", "ensemble", "presenter", "venue", "festival",
        "service_provider", "retailer", "institution",
    },
    "genre": {
        "unknown", "classical", "choral", "opera", "jazz", "world_music",
        "folk", "blues", "country", "rock_indie", "dance", "theatre",
        "film", "spoken_word",
    },
    "affiliation": {
        "unknown", "harvard_affiliated", "mit_affiliated", "cambridge_based",
        "boston_based", "greater_boston", "berkshires", "cape_ann",
        "new_england_regional", "national", "international",
    },
    "cadence": {
        "unknown", "term_driven", "year_round", "admissions_window",
        "seasonal_spring", "seasonal_summer", "seasonal_fall",
        "seasonal_winter", "move_window",
    },
    "daypart_fit": {
        "unknown", "classical", "jazz", "blues_hillbilly",
        "record_hospital", "darker_side", "sports_news",
    },
    "history": {
        "unknown", "wcrb_sponsor", "wgbh_sponsor", "wbur_sponsor",
        "wumb_sponsor", "wers_sponsor", "peer_public_radio",
        "program_book_sponsor", "hpin_certified",
    },
    "compliance": {"unknown", "political"},
    "other": {"unknown"},
}


# -------------------------------------------------------------------------
# Vocab cache
# -------------------------------------------------------------------------

_LOCK = threading.Lock()
_CACHE: dict[str, set[str]] | None = None
_MISS_COUNT = 0
_MISS_THRESHOLD = 5


def _load_vocab_from_db() -> dict[str, set[str]] | None:
    """Try to load vocab from Supabase. Return ``None`` on any failure."""
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        return None
    try:
        from supabase import create_client

        client = create_client(url, key)
        # We need EVERY status here so a merge-archived vocab row still
        # resolves for an in-flight pipeline run. The filter happens
        # downstream in the /admin UI.
        rows = (
            client.table("tag_vocabulary")
            .select("axis,value,status")
            .execute()
            .data
            or []
        )
    except Exception:
        return None
    out: dict[str, set[str]] = {axis: set() for axis in _VALID_AXES}
    for r in rows:
        axis = r.get("axis")
        val = r.get("value")
        if axis in out and val:
            out[axis].add(val)
    # If the DB round-trip returns an empty vocab, prefer the seed fallback
    # rather than trusting an almost-certainly-broken read.
    if not any(out.values()):
        return None
    return out


def _vocab() -> dict[str, set[str]]:
    """Return the cached vocab, loading it lazily."""
    global _CACHE
    if _CACHE is not None:
        return _CACHE
    with _LOCK:
        if _CACHE is not None:
            return _CACHE
        loaded = _load_vocab_from_db()
        if loaded is None:
            loaded = {axis: set(vals) for axis, vals in _SEED_VOCAB.items()}
        _CACHE = loaded
        return _CACHE


def reset_cache() -> None:
    """Drop the in-process vocab cache. Useful in tests."""
    global _CACHE, _MISS_COUNT
    with _LOCK:
        _CACHE = None
        _MISS_COUNT = 0


# -------------------------------------------------------------------------
# Miss-threshold alerting
# -------------------------------------------------------------------------

def _record_miss(axis: str, value: str, source: str | None) -> None:
    """Emit a tag_vocab_miss event; alert when the per-run threshold trips."""
    global _MISS_COUNT
    with _LOCK:
        _MISS_COUNT += 1
        now = _MISS_COUNT
    event_log.warn(
        "tag_vocab_miss",
        f"unknown tag value {axis}:{value}",
        context={
            "axis": axis,
            "value": value,
            "source": source,
            "miss_count_this_run": now,
        },
    )
    if now == _MISS_THRESHOLD + 1:
        # One-shot admin alert: crossed the "more than 5 misses" bar.
        event_log.warn(
            "tag_vocab_miss_threshold",
            f"vocab miss threshold crossed (>{_MISS_THRESHOLD} unknowns this run)",
            context={"threshold": _MISS_THRESHOLD, "miss_count": now},
        )


# -------------------------------------------------------------------------
# Public API
# -------------------------------------------------------------------------

def build_tag_set(
    *,
    sector: str | list[str] | None = None,
    operating_model: str | list[str] | None = None,
    genre: str | list[str] | None = None,
    affiliation: str | list[str] | None = None,
    cadence: str | list[str] | None = None,
    history: str | list[str] | None = None,
    compliance: str | list[str] | None = None,
    other: str | list[str] | None = None,
    # daypart_fit is derived, not emitted — kwarg intentionally absent.
    source: str | None = None,
    strict: bool | None = None,
) -> dict[str, list[str]]:
    """Build a ``{axis: [values]}`` dict for a source-emitted row.

    Each axis kwarg accepts ``None`` (skip), a single string, or a list of
    strings. Unknown values in strict mode raise :class:`UnknownVocabError`;
    in lax mode they log ``tag_vocab_miss`` + emit ``{axis}:unknown``.

    ``daypart_fit`` is intentionally not accepted — it is compute-on-read
    via the SQL view in migration 008.
    """
    if strict is None:
        strict = _strict_default()

    inputs = {
        "sector": sector,
        "operating_model": operating_model,
        "genre": genre,
        "affiliation": affiliation,
        "cadence": cadence,
        "history": history,
        "compliance": compliance,
        "other": other,
    }
    vocab = _vocab()
    out: dict[str, list[str]] = {}

    for axis, raw in inputs.items():
        if raw is None:
            continue
        values = raw if isinstance(raw, list) else [raw]
        valid_set = vocab.get(axis, set())
        cleaned: list[str] = []
        for v in values:
            if v is None:
                continue
            v = str(v).strip()
            if not v:
                continue
            if v in valid_set:
                cleaned.append(v)
                continue
            if strict:
                raise UnknownVocabError(
                    f"unknown vocab {axis}:{v!r} (source={source!r}); "
                    f"add to seed_tags.sql + TAGS.md or disable "
                    f"WHRB_VOCAB_STRICT"
                )
            # Lax fallback: emit the axis-specific 'unknown' placeholder.
            _record_miss(axis, v, source)
            if "unknown" in valid_set:
                cleaned.append("unknown")
        if cleaned:
            # Dedup while preserving insertion order for deterministic CSV.
            seen: set[str] = set()
            deduped: list[str] = []
            for v in cleaned:
                if v in seen:
                    continue
                seen.add(v)
                deduped.append(v)
            out[axis] = deduped
    return out


# -------------------------------------------------------------------------
# ZIP → affiliation
# -------------------------------------------------------------------------

# Cambridge proper — Harvard Square is 02138; Central/Porter/Kendall fill out.
_CAMBRIDGE_ZIPS = frozenset({"02138", "02139", "02140", "02141", "02142"})

# Boston proper (neighborhoods): Back Bay / South End / Fenway / JP / Allston /
# Brighton / Longwood. Note 02115 / 02215 and Roxbury / Mission Hill sit in
# Boston even though they're sometimes grouped with Brookline.
_BOSTON_ZIPS = frozenset(
    {
        "02115", "02116", "02118", "02130", "02134", "02135", "02215",
    }
)

# Greater Boston: Somerville / Brookline / Belmont / Watertown / Arlington
# / Medford / Malden / Everett / Chelsea / Revere / Lynn / Peabody / Salem /
# Winchester / Melrose — basically the rest of WHRB_ZIPS.
_GREATER_BOSTON_ZIPS = frozenset(
    {
        "02143", "02144", "02145",            # Somerville
        "02445", "02446",                      # Brookline
        "02472", "02474", "02476", "02478",    # Belmont / Watertown / Arlington
        "01970", "01960", "01901",             # Salem / Peabody / Lynn
        "02151", "02150", "02149",             # Revere / Chelsea / Everett
        "02148", "02155", "02176", "01890",    # Malden / Medford / Melrose / Winchester
    }
)


def affiliation_for_zip(zip_raw: str | None) -> str | None:
    """Map a 5-digit ZIP to the most specific metro affiliation.

    Returns one of the three ZIP-derivable affiliations
    (``cambridge_based`` / ``boston_based`` / ``greater_boston``), or
    ``None`` if the ZIP is outside every WHRB signal ring. Harvard and
    MIT affiliation is NOT derived from ZIP — those require directory
    enrichment (T6).
    """
    if not zip_raw:
        return None
    z = str(zip_raw).strip()[:5]
    if z in _CAMBRIDGE_ZIPS:
        return "cambridge_based"
    if z in _BOSTON_ZIPS:
        return "boston_based"
    if z in _GREATER_BOSTON_ZIPS:
        return "greater_boston"
    return None


# -------------------------------------------------------------------------
# OSM category → (sector, operating_model) mapping
# -------------------------------------------------------------------------

# Canonical WHRB-side translation of OSM category keys (``amenity``, ``shop``,
# ``office``, ``craft``, ``tourism``, ``leisure``). Each value is a tuple of
# ``(sector, operating_model)``. Missing keys fall back to ``(None, None)``;
# the caller can still emit an affiliation without a sector.
_OSM_CATEGORY_MAP: dict[str, tuple[str | None, str | None]] = {
    # --- Arts / cultural ---
    "amenity=theatre":       ("arts", "venue"),
    "amenity=arts_centre":   ("arts", "venue"),
    "tourism=museum":        ("arts", "institution"),
    "amenity=concert_hall":  ("arts", "venue"),
    "shop=art":              ("retail", "retailer"),
    "shop=musical_instrument": ("retail", "retailer"),
    # --- Restaurants / hospitality ---
    "amenity=restaurant":    ("hospitality", "retailer"),
    "amenity=cafe":          ("hospitality", "retailer"),
    "amenity=bar":           ("hospitality", "retailer"),
    "amenity=pub":           ("hospitality", "retailer"),
    "amenity=ice_cream":     ("hospitality", "retailer"),
    # --- Retail ---
    "shop=books":            ("retail", "retailer"),
    "shop=jewelry":          ("retail", "retailer"),
    "shop=clothes":          ("retail", "retailer"),
    "shop=wine":             ("retail", "retailer"),
    "shop=bakery":           ("retail", "retailer"),
    "shop=butcher":          ("retail", "retailer"),
    "shop=optician":         ("retail", "retailer"),
    "shop=garden_centre":    ("retail", "retailer"),
    # --- Professional services / medical ---
    "amenity=dentist":       ("medical", "service_provider"),
    "amenity=doctors":       ("medical", "service_provider"),
    "amenity=veterinary":    ("medical", "service_provider"),
    "office=lawyer":         ("finance", "service_provider"),
    "office=accountant":     ("finance", "service_provider"),
    "office=estate_agent":   ("real_estate", "service_provider"),
    "leisure=fitness_centre":("hospitality", "service_provider"),
    # --- Home-services trades ---
    "craft=plumber":         ("home_services", "service_provider"),
    "craft=electrician":     ("home_services", "service_provider"),
    "craft=hvac":            ("home_services", "service_provider"),
    "craft=painter":         ("home_services", "service_provider"),
    "craft=carpenter":       ("home_services", "service_provider"),
    "craft=gardener":        ("home_services", "service_provider"),
    "craft=roofer":          ("home_services", "service_provider"),
}


def osm_category_to_tags(osm_category: str | None) -> tuple[str | None, str | None]:
    """Return ``(sector, operating_model)`` for an OSM ``k=v`` category."""
    if not osm_category:
        return (None, None)
    return _OSM_CATEGORY_MAP.get(osm_category, (None, None))


# -------------------------------------------------------------------------
# Yelp alias → sector heuristic
# -------------------------------------------------------------------------

_YELP_ALIAS_TO_SECTOR: dict[str, tuple[str | None, str | None]] = {
    # Home-services trades (every WHRB_SEARCHES entry that lands in Tier C)
    "landscaping":   ("home_services", "service_provider"),
    "lawn":          ("home_services", "service_provider"),
    "tree":          ("home_services", "service_provider"),
    "snow":          ("home_services", "service_provider"),
    "hvac":          ("home_services", "service_provider"),
    "painter":       ("home_services", "service_provider"),
    "handyman":      ("home_services", "service_provider"),
    "cleaning":      ("home_services", "service_provider"),
    "pest":          ("home_services", "service_provider"),
    "mover":         ("home_services", "service_provider"),
    "moving":        ("home_services", "service_provider"),
    "plumber":       ("home_services", "service_provider"),
    "electrician":   ("home_services", "service_provider"),
    "roofer":        ("home_services", "service_provider"),
    # Professional services / education
    "tutor":         ("education", "service_provider"),
    "tax":           ("finance", "service_provider"),
    "piano":         ("education", "service_provider"),
    "dog":           ("hospitality", "service_provider"),   # dog walker / trainer
    # Hospitality
    "restaurant":    ("hospitality", "retailer"),
    "cafe":          ("hospitality", "retailer"),
    "bar":           ("hospitality", "retailer"),
    # Retail
    "book":          ("retail", "retailer"),
    "jewelry":       ("retail", "retailer"),
    "clothing":      ("retail", "retailer"),
}


def yelp_alias_to_tags(alias: str | None) -> tuple[str | None, str | None]:
    """Map a Yelp category alias to ``(sector, operating_model)``.

    Yelp aliases are comma-delimited when the business has multiple (e.g.
    ``"hvac,electrician,plumbing"``). We match against the first alias
    that hits the heuristic dictionary. Returns ``(None, None)`` if no
    prefix matches.
    """
    if not alias:
        return (None, None)
    parts = [p.strip().lower() for p in str(alias).split(",") if p.strip()]
    for part in parts:
        for key, pair in _YELP_ALIAS_TO_SECTOR.items():
            if key in part:
                return pair
    return (None, None)


# -------------------------------------------------------------------------
# Boston food / Cambridge diversity / Somerville permit → sector
# -------------------------------------------------------------------------

def city_category_to_tags(
    source_key: str,
    category: str | None,
) -> tuple[str | None, str | None]:
    """Return ``(sector, operating_model)`` for a city-licenses row.

    The source_key tells us the dataset provenance; category refines when
    available. We never invent a tag from a name heuristic — only from
    explicit dataset-provided columns.
    """
    if source_key == "boston_food":
        return ("hospitality", "retailer")
    cat = (category or "").lower()
    if source_key == "cambridge_diversity":
        if "food" in cat or "restaurant" in cat:
            return ("hospitality", "retailer")
        if "retail" in cat or "store" in cat or "shop" in cat:
            return ("retail", "retailer")
        if "health" in cat or "medical" in cat:
            return ("medical", "service_provider")
        if "construction" in cat or "contractor" in cat or "trade" in cat:
            return ("home_services", "service_provider")
        # Anything else from the diversity directory stays untagged on
        # sector — the zip-based affiliation is usually the stronger signal.
        return (None, None)
    if source_key == "somerville_permits":
        if "food" in cat or "liquor" in cat:
            return ("hospitality", "retailer")
        if "occupancy" in cat:
            # Generic certificate-of-occupancy — no usable sector signal.
            return (None, None)
        return (None, None)
    return (None, None)
