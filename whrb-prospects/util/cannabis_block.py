"""Cannabis hard-block (Stage T2, plan §4.4).

Filters rows whose company name matches a licensed Massachusetts cannabis
establishment, or whose OSM/Yelp category is an exact cannabis-retail hit.
Cannabis is NEVER a tag — per plan §1.3 #6 it's blocked upstream so the
prospect never reaches the sales team.

Four-layer source stack (decreasing trust):

1. **Primary** — Mass Cannabis Control Commission open-data CSV.
   ``https://masscannabiscontrol.com/resource/l_licenses_all_details_public.csv``
   24 h TTL via ``requests-cache``. Columns we care about: ``BUSINESS_NAME``.
2. **Secondary** — same dataset, JSON transport, same provider.
   Used when the CSV fetch fails (nginx 5xx / connection reset / timeout).
3. **Tertiary (persistent on-disk cache)** — ``cache/ccc_licensees_latest.csv``.
   Written on every successful primary OR secondary fetch. Read when both
   live sources fail. Cache-staleness policy: if its ``mtime`` is older
   than 72 h AND both live sources fail, we **fail closed** — suspend the
   pipeline run rather than proceed without cannabis screening.
4. **Overlay** — ``data/ccc_manual_blocklist.txt`` (checked into the repo).
   Admin-appended business names the CCC hasn't published yet (e.g. a newly
   licensed dispensary). Unioned into the set on every run regardless of
   which layers succeeded; a blocklist entry is never ignored.

OSM/Yelp category match is a secondary safety net — not every CCC-licensed
dispensary has its name scraped cleanly, but OpenStreetMap's
``shop=cannabis`` and Yelp's ``cannabisdispensaries`` aliases are explicit.

No keyword matching. The name "Indica Lounge" is not a cannabis business;
"Weed Whackers" is a landscaper. Fuzzy matching over "weed" / "cannabis"
would over-block far more than it catches, and the CCC licensee list is
authoritative for business names.
"""
from __future__ import annotations

import csv
import io
import os
import sys
import time
from collections.abc import Callable
from pathlib import Path

import requests

from enrich.dedupe import _norm_name
from util import event_log

LicenseeParser = Callable[[bytes], "set[str]"]

# -------------------------------------------------------------------------
# Source URLs + file paths
# -------------------------------------------------------------------------

CCC_CSV_URL = (
    "https://masscannabiscontrol.com/resource/l_licenses_all_details_public.csv"
)
CCC_JSON_URL = (
    "https://masscannabiscontrol.com/resource/l_licenses_all_details_public.json"
)

_THIS = Path(__file__).resolve()
_PROSPECTS_ROOT = _THIS.parent.parent
_CACHE_DIR = _PROSPECTS_ROOT / "cache"
_DATA_DIR = _PROSPECTS_ROOT / "data"

ON_DISK_CACHE = _CACHE_DIR / "ccc_licensees_latest.csv"
MANUAL_OVERLAY = _DATA_DIR / "ccc_manual_blocklist.txt"

CACHE_STALE_AFTER_SECONDS = 72 * 3600  # 72 h — plan §4.4 fail-closed bar.
LIVE_FETCH_TIMEOUT_SECONDS = 30

# masscannabiscontrol.com 403s default python-requests UAs. Advertise ourselves
# honestly and plan §1.3 #13 ethics posture (identify + respect robots.txt).
_UA = (
    "Mozilla/5.0 (whrb-prospects research crawler; "
    "contact: whrb.org; compliance: cannabis-block)"
)
_DEFAULT_HEADERS = {"User-Agent": _UA, "Accept": "*/*"}

# Categories treated as "obviously cannabis retail" regardless of the CCC list.
_CANNABIS_CATEGORIES = frozenset(
    {
        "shop=cannabis",
        "cannabisdispensaries",
        "cannabis_clinic",
    }
)


class CannabisBlockStale(RuntimeError):
    """Raised when every layer is down + the on-disk cache is > 72 h old."""


# -------------------------------------------------------------------------
# Lazy module-level cache
# -------------------------------------------------------------------------

_LICENSEE_NAMES: set[str] | None = None
_LICENSEE_LAYER: str | None = None  # "primary" | "secondary" | "tertiary"
_LAST_LOAD_ATTEMPT_AT: float = 0.0


def _read_manual_overlay() -> set[str]:
    """Load admin-maintained names (one per line, # comments ignored)."""
    if not MANUAL_OVERLAY.exists():
        return set()
    out: set[str] = set()
    for raw in MANUAL_OVERLAY.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        out.add(_norm_name(line))
    return out


def _parse_csv_bytes(payload: bytes) -> set[str]:
    """Pull the ``BUSINESS_NAME`` column out of the CCC CSV."""
    text = payload.decode("utf-8", errors="replace")
    reader = csv.DictReader(io.StringIO(text))
    out: set[str] = set()
    for row in reader:
        name = row.get("BUSINESS_NAME") or row.get("business_name")
        if name:
            out.add(_norm_name(name))
    return out


def _parse_json_bytes(payload: bytes) -> set[str]:
    """Pull ``BUSINESS_NAME`` out of the CCC JSON (Socrata-style array)."""
    import json

    try:
        rows = json.loads(payload.decode("utf-8", errors="replace"))
    except json.JSONDecodeError:
        return set()
    if not isinstance(rows, list):
        return set()
    out: set[str] = set()
    for r in rows:
        if not isinstance(r, dict):
            continue
        name = (
            r.get("BUSINESS_NAME")
            or r.get("business_name")
            or r.get("businessName")
        )
        if name:
            out.add(_norm_name(str(name)))
    return out


def _write_persistent_cache(payload: bytes, suffix: str = ".csv") -> None:
    """Atomic write to cache/ccc_licensees_latest.csv."""
    try:
        _CACHE_DIR.mkdir(parents=True, exist_ok=True)
        tmp = ON_DISK_CACHE.with_suffix(ON_DISK_CACHE.suffix + ".tmp")
        tmp.write_bytes(payload)
        os.replace(tmp, ON_DISK_CACHE)
    except OSError as e:
        # Persistent-cache writes are best-effort; a read-only FS on CI
        # shouldn't break the pipeline.
        print(
            f"[cannabis_block] persistent cache write skipped: {e}",
            file=sys.stderr,
        )


def _fetch_layer(url: str, parser: LicenseeParser) -> set[str] | None:
    """Return parsed licensee names, or ``None`` on network/parse failure."""
    try:
        r = requests.get(
            url,
            timeout=LIVE_FETCH_TIMEOUT_SECONDS,
            headers=_DEFAULT_HEADERS,
        )
    except Exception as e:
        event_log.warn(
            "ccc_fetch_failed",
            f"CCC live fetch transport error: {type(e).__name__}: {e}",
            context={"url": url},
        )
        return None
    if r.status_code >= 400:
        event_log.warn(
            "ccc_fetch_failed",
            f"CCC live fetch returned HTTP {r.status_code}",
            context={"url": url, "http_status": r.status_code},
        )
        return None
    try:
        names = parser(r.content)
    except Exception as e:
        event_log.warn(
            "ccc_fetch_failed",
            f"CCC payload parse failure: {type(e).__name__}: {e}",
            context={"url": url},
        )
        return None
    if not names:
        event_log.warn(
            "ccc_fetch_failed",
            "CCC payload parsed to zero licensee names",
            context={"url": url},
        )
        return None
    return names


def _load_persistent_cache() -> set[str] | None:
    """Read cache/ccc_licensees_latest.csv. Returns ``None`` if absent."""
    if not ON_DISK_CACHE.exists():
        return None
    try:
        payload = ON_DISK_CACHE.read_bytes()
    except OSError:
        return None
    names = _parse_csv_bytes(payload)
    return names or None


def _cache_age_seconds() -> float | None:
    if not ON_DISK_CACHE.exists():
        return None
    try:
        return max(0.0, time.time() - ON_DISK_CACHE.stat().st_mtime)
    except OSError:
        return None


def _load_licensee_names() -> set[str]:
    """Resolve the licensee-name set via the four-layer fallback.

    Always unions :func:`_read_manual_overlay` into the result so a
    hand-maintained overlay entry is never dropped.
    """
    global _LICENSEE_LAYER
    names: set[str] | None = None

    # Layer 1: primary CSV via requests-cache (24 h TTL).
    names = _fetch_layer(CCC_CSV_URL, _parse_csv_bytes)
    if names is not None:
        _LICENSEE_LAYER = "primary"
        # Persist the raw CSV bytes so Tertiary can still mirror the feed
        # even though _fetch_layer has already consumed them. Refetch
        # uncached once so requests-cache doesn't push stale bytes onto
        # disk; callers typically install requests-cache in the pipeline.
        try:
            raw = requests.get(
                CCC_CSV_URL,
                timeout=LIVE_FETCH_TIMEOUT_SECONDS,
                headers=_DEFAULT_HEADERS,
            ).content
            if raw:
                _write_persistent_cache(raw)
        except Exception:
            pass

    # Layer 2: secondary JSON (same provider, transport-level failover).
    if names is None:
        names = _fetch_layer(CCC_JSON_URL, _parse_json_bytes)
        if names is not None:
            _LICENSEE_LAYER = "secondary"
            # Serialize JSON names back to CSV so Tertiary is always CSV.
            csv_buf = io.StringIO()
            writer = csv.writer(csv_buf)
            writer.writerow(["BUSINESS_NAME"])
            for n in sorted(names):
                writer.writerow([n])
            _write_persistent_cache(csv_buf.getvalue().encode("utf-8"))

    # Layer 3: persistent on-disk cache.
    if names is None:
        on_disk = _load_persistent_cache()
        age = _cache_age_seconds()
        if on_disk is not None and age is not None and age <= CACHE_STALE_AFTER_SECONDS:
            names = on_disk
            _LICENSEE_LAYER = "tertiary"
            event_log.warn(
                "ccc_fetch_failed",
                "CCC live sources down; using on-disk cache",
                context={"cache_age_seconds": age},
            )
        else:
            # Fail-closed: over-blocking is recoverable, under-blocking isn't.
            event_log.fatal(
                "ccc_fetch_stale_fatal",
                "CCC live + cache unavailable; suspending pipeline run",
                context={
                    "cache_present": on_disk is not None,
                    "cache_age_seconds": age,
                    "threshold_seconds": CACHE_STALE_AFTER_SECONDS,
                },
            )
            event_log.flush()
            raise CannabisBlockStale(
                "CCC licensee data unavailable: primary + secondary fetch "
                "failed and on-disk cache is missing or > 72 h old. "
                "Pipeline suspended to avoid shipping prospects without "
                "cannabis screening."
            )

    # Layer 4: always-on manual overlay.
    overlay = _read_manual_overlay()
    if overlay:
        names |= overlay
    return names


def licensee_names(*, force_reload: bool = False) -> set[str]:
    """Return the cached licensee-name set; load it once per process."""
    global _LICENSEE_NAMES, _LAST_LOAD_ATTEMPT_AT
    if _LICENSEE_NAMES is not None and not force_reload:
        return _LICENSEE_NAMES
    _LAST_LOAD_ATTEMPT_AT = time.time()
    _LICENSEE_NAMES = _load_licensee_names()
    event_log.info(
        "ccc_load",
        f"loaded {len(_LICENSEE_NAMES)} CCC licensee names",
        context={"layer": _LICENSEE_LAYER, "count": len(_LICENSEE_NAMES)},
    )
    return _LICENSEE_NAMES


def _reset_for_tests() -> None:
    """Drop the module-level cache (tests only)."""
    global _LICENSEE_NAMES, _LICENSEE_LAYER
    _LICENSEE_NAMES = None
    _LICENSEE_LAYER = None


# -------------------------------------------------------------------------
# Public API — called by pipeline.py before dedupe
# -------------------------------------------------------------------------

def is_cannabis(row: dict) -> bool:
    """Return True if a row should be hard-blocked as cannabis retail.

    Match rules (in order):
      1. Normalized ``company_name`` matches a CCC licensee name (or a
         manual-overlay entry).
      2. ``category`` / ``osm_tag`` / ``yelp_category`` contains an exact
         cannabis-retail marker (``shop=cannabis``, ``cannabisdispensaries``).

    Address matches alone do not trigger a block — the plan explicitly
    rejects address-similarity as a signal (too many landlord-shared
    buildings).
    """
    name = _norm_name(row.get("company_name"))
    if name and name in licensee_names():
        return True

    for key in ("category", "osm_tag", "yelp_category"):
        val = row.get(key)
        if not val:
            continue
        if isinstance(val, str) and val.strip() in _CANNABIS_CATEGORIES:
            return True
    return False


def filter_rows(rows: list[dict]) -> list[dict]:
    """Drop every row for which :func:`is_cannabis` is True.

    Emits one ``cannabis_blocked`` event per dropped row. Re-raises
    :class:`CannabisBlockStale` so the pipeline can suspend cleanly.
    """
    # Preload so every dropped row shares the same layer-origin attribution.
    try:
        licensee_names()
    except CannabisBlockStale:
        raise
    out: list[dict] = []
    for r in rows:
        try:
            blocked = is_cannabis(r)
        except CannabisBlockStale:
            raise
        if blocked:
            event_log.warn(
                "cannabis_blocked",
                f"blocked cannabis row: {r.get('company_name')!r}",
                context={
                    "company_name": r.get("company_name"),
                    "zip": r.get("zip"),
                    "source": r.get("source"),
                    "category": r.get("category"),
                },
            )
            continue
        out.append(r)
    return out
