"""Nonprofit enrichment via the IRS Exempt Organizations Business Master File.

Runs as pipeline phase ``07a_nonprofit`` (between ``07_validated`` and
``08_supabase_sync``). On each row whose normalized company name matches a
Massachusetts-extract BMF entry, the pass stamps
``is_nonprofit=True / ein=<NN-NNNNNNN> / nonprofit_source='irs_bmf'``.

* Data source: ``https://www.irs.gov/pub/irs-soi/eo_ma.csv`` (MA extract).
* Cache: ``whrb-prospects/cache/irs_bmf_ma.csv`` with a 30-day TTL.
* Matching: ``enrich.dedupe._norm_name`` + an additional suffix-strip pass
  (``_STRIP_TOKENS``) so "Museum of Fine Arts" matches "Trustees of the
  Museum of Fine Arts" and "Handel and Haydn" matches "Handel and Haydn
  Society". Conservative by design — expand the token list only if a
  canonical spot-check fails.
* Manual override: rows whose ``user_overrides`` already contains
  ``is_nonprofit`` are skipped entirely — no flag, EIN, or source changes.
  (This is what protects the Stage 4 manual-override test.)
* Logging: emits ``category='bmf_download' level='info'`` **only** when a
  cold cache causes a network fetch; the Stage 4 cache-freshness integrity
  test uses the absence of that event on a second run to prove reuse.
"""
from __future__ import annotations

import csv
import os
import time
from collections.abc import Iterable
from pathlib import Path

import requests

from config import NONPROFIT_BMF_CACHE_TTL_SECONDS
from enrich.dedupe import _norm_name
from util import event_log

BMF_URL = "https://www.irs.gov/pub/irs-soi/eo_ma.csv"
CACHE_PATH = Path(__file__).resolve().parent.parent / "cache" / "irs_bmf_ma.csv"
# Re-exported for backwards compatibility with scripts that imported it directly.
CACHE_TTL_SECONDS = NONPROFIT_BMF_CACHE_TTL_SECONDS

# Tokens to strip from both sides of the match in addition to _norm_name's
# punctuation/case normalization. Ordering matters only in that multi-word
# phrases must be matched before single words; we handle that with regex
# word-boundary replacements applied iteratively.
_STRIP_TOKENS = (
    "trustees of the",
    "trustees of",
    "museum of",
    "society of",
    "association of",
    "friends of",
    "the",
    "inc",
    "incorporated",
    "corp",
    "corporation",
    "llc",
    "ltd",
    "limited",
    "co",
    "company",
    "foundation",
    "fund",
    "trust",
    "association",
    "society",
    "institute",
    # Round-8 spot-check expansions (Stage 4 session, 2026-04-18):
    # `and` — required for "Handel & Haydn" (scraped) vs "HANDEL AND HAYDN SOCIETY" (BMF).
    #         `&` normalizes to whitespace; stripping "and" on both sides lines them up.
    "and",
)

# In-memory cache so repeated calls inside one pipeline run don't re-parse
# the 90k-row BMF file.
_LOOKUP: dict[str, dict] | None = None


def _strip_suffix_tokens(name: str) -> str:
    """Apply ``_STRIP_TOKENS`` removal after ``_norm_name``. Returns a
    whitespace-normalized string. Empty input -> empty output.
    """
    if not name:
        return ""
    out = f" {name} "
    # Iterate until stable: multi-pass handles e.g. "trustees of the museum of"
    # collapsing through several overlapping tokens.
    for _ in range(4):
        before = out
        for tok in _STRIP_TOKENS:
            out = out.replace(f" {tok} ", " ")
        if out == before:
            break
    return " ".join(out.split())


def _match_key(name: str | None) -> str:
    return _strip_suffix_tokens(_norm_name(name))


def _format_ein(raw: str | None) -> str | None:
    """IRS BMF publishes EINs as 9 digits. Format as ``NN-NNNNNNN``."""
    if not raw:
        return None
    digits = "".join(ch for ch in str(raw) if ch.isdigit())
    if len(digits) != 9:
        return None
    return f"{digits[:2]}-{digits[2:]}"


def _cache_is_fresh(path: Path) -> bool:
    if not path.exists():
        return False
    age = time.time() - path.stat().st_mtime
    return age < CACHE_TTL_SECONDS


def _download_bmf(path: Path) -> None:
    """Fetch the MA BMF CSV to ``path``. Emits the ``bmf_download`` event."""
    path.parent.mkdir(parents=True, exist_ok=True)
    event_log.info(
        "bmf_download",
        f"downloading IRS BMF MA extract from {BMF_URL}",
        context={"url": BMF_URL, "cache_path": str(path)},
    )
    r = requests.get(BMF_URL, timeout=120)
    r.raise_for_status()
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_bytes(r.content)
    os.replace(tmp, path)


def _ensure_cache() -> Path:
    if not _cache_is_fresh(CACHE_PATH):
        _download_bmf(CACHE_PATH)
    return CACHE_PATH


def _load_lookup(force: bool = False) -> dict[str, dict]:
    """Return ``{match_key: {"ein": "NN-NNNNNNN", "name": original}}``.

    Cached in module state; pass ``force=True`` to rebuild (tests).
    """
    global _LOOKUP
    if _LOOKUP is not None and not force:
        return _LOOKUP
    path = _ensure_cache()
    out: dict[str, dict] = {}
    with path.open("r", encoding="utf-8", errors="replace", newline="") as f:
        reader = csv.DictReader(f)
        name_col = None
        ein_col = None
        for candidate in reader.fieldnames or []:
            if candidate.strip().upper() == "NAME":
                name_col = candidate
            elif candidate.strip().upper() == "EIN":
                ein_col = candidate
        if not name_col or not ein_col:
            # Fallback: positional (EIN first column, NAME second) per historical
            # IRS format. Re-open the file with a plain reader.
            f.seek(0)
            plain = csv.reader(f)
            for row in plain:
                if not row or len(row) < 2:
                    continue
                ein_raw = row[0]
                name = row[1]
                ein = _format_ein(ein_raw)
                if not ein:
                    continue
                key = _match_key(name)
                if key and key not in out:
                    out[key] = {"ein": ein, "name": name}
            _LOOKUP = out
            return out
        for dict_row in reader:
            ein = _format_ein(dict_row.get(ein_col))
            name_val = dict_row.get(name_col)
            if not ein or not name_val:
                continue
            name = name_val
            key = _match_key(name)
            if not key:
                continue
            # First-writer-wins keeps the lookup deterministic; duplicates are
            # common (multiple records per legal entity).
            if key not in out:
                out[key] = {"ein": ein, "name": name}
    _LOOKUP = out
    return out


def enrich_rows(rows: Iterable[dict]) -> dict:
    """Annotate rows in place. Returns a summary dict."""
    lookup = _load_lookup()
    summary = {"total": 0, "matched": 0, "skipped_override": 0}
    for r in rows:
        summary["total"] += 1
        overrides = r.get("user_overrides") or {}
        if isinstance(overrides, dict) and overrides.get("is_nonprofit"):
            # Manual override takes precedence; never touch the flag fields.
            summary["skipped_override"] += 1
            continue
        key = _match_key(r.get("company_name"))
        if not key:
            continue
        hit = lookup.get(key)
        if not hit:
            continue
        r["is_nonprofit"] = True
        r["ein"] = hit["ein"]
        r["nonprofit_source"] = "irs_bmf"
        summary["matched"] += 1
    event_log.info(
        "bmf_enrichment",
        f"BMF enrichment complete: matched {summary['matched']}/{summary['total']}",
        context=summary,
    )
    return summary
