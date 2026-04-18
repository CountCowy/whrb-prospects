"""Pipeline -> Supabase ``public.prospects`` sync (phase 08_supabase_sync).

The contract:

* Derive a stable ``business_key`` per row (normalized 10-digit phone if
  present, else ``normalized_name|zip``).
* Upsert by ``business_key``. New rows get inserted verbatim; existing rows
  get PATCHed column-by-column, skipping any field present in
  ``user_overrides`` (edit lock).
* ``priority_score`` is authoritative-from-pipeline: it is always refreshed
  on upsert unless the user has explicitly locked it via
  ``user_overrides['priority_score']`` (round-7 clarification).
* Every batch is wrapped in a tenacity-style retry (3 attempts, bounded
  exponential backoff) using the same ``RETRYABLE_EXCEPTIONS`` set as
  ``util/http.py``. A batch that exhausts retries emits an
  ``event_log`` error row and the sync continues with the next batch — a
  single failed batch never aborts the whole sync.

``seed_source_config`` is called at run start (by ``pipeline.py``) before
reading ``source_config.enabled`` flags; it is idempotent.
"""
from __future__ import annotations

import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

import requests
from dotenv import load_dotenv
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from enrich.dedupe import _norm_name, _norm_phone
from util import event_log
from util.http import RETRYABLE_EXCEPTIONS

_WHRB_PROSPECTS = Path(__file__).resolve().parent.parent
load_dotenv(_WHRB_PROSPECTS / ".env")

# 20 CSV columns minus `priority_score` (authoritative-from-pipeline but
# separately handled below). The DB column rename `notes` -> `pipeline_notes`
# already happened as pre-Stage-2 prep.
SCRAPED_FIELDS = (
    "company_name",
    "website",
    "company_phone",
    "company_email",
    "sales_email",
    "contact_name",
    "contact_title",
    "contact_email",
    "contact_phone",
    "contact_linkedin",
    "address",
    "zip",
    "tier",
    "category",
    "rating",
    "review_count",
    "source",
    "seasonality_window",
    "pipeline_notes",
)

# Integer columns in public.prospects — pandas floats must be int-coerced.
INT_FIELDS = ("review_count",)

# Scrapers that can be toggled from /admin/sources (Stage 9). Seeded idempotently.
SOURCE_KEYS = (
    "osm",
    "yelp",
    "ma_hic",
    "city_licenses",
    "chambers",
    "best_of_boston",
    "program_books",
    "huntington",
    "bbb",
)

BATCH_SIZE = 500
_CLIENT = None


def _client():
    global _CLIENT
    if _CLIENT is not None:
        return _CLIENT
    from supabase import create_client

    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    _CLIENT = create_client(url, key)
    return _CLIENT


def _as_str(value: Any) -> str | None:
    """Coerce pandas/NaN/non-string values to a clean string or None."""
    if value is None:
        return None
    if isinstance(value, float) and value != value:  # NaN
        return None
    s = str(value).strip()
    return s or None


def business_key(row: dict) -> str | None:
    """Stable identity: normalized phone (10 digits) if present, else
    ``name|zip``. Returns ``None`` if neither is derivable (row is skipped).
    """
    phone_raw = _as_str(row.get("company_phone")) or _as_str(row.get("contact_phone"))
    phone = _norm_phone(phone_raw)
    if phone and len(phone) == 10:
        return f"phone:{phone}"
    name = _norm_name(_as_str(row.get("company_name")))
    zip_ = (_as_str(row.get("zip")) or "")[:5].strip()
    if name and zip_:
        return f"name:{name}|{zip_}"
    if name:
        return f"name:{name}"
    return None


def _split_alt_fields(row: dict) -> tuple[dict, dict]:
    """Partition scraped row into (base cols, alt_fields jsonb)."""
    alt: dict[str, Any] = {}
    base: dict[str, Any] = {}
    for k, v in row.items():
        if k.startswith("alt_"):
            alt[k[4:]] = v
        else:
            base[k] = v
    return base, alt


def _coerce(value: Any) -> Any:
    """Normalize pandas/scalar NaN and empty strings to None so SQL gets NULL."""
    if value is None:
        return None
    # NaN check without importing numpy
    if isinstance(value, float) and value != value:
        return None
    if isinstance(value, str):
        s = value.strip()
        return s if s else None
    return value


def _utcnow_iso() -> str:
    return datetime.now(tz=timezone.utc).isoformat()


def _build_insert(row: dict, bk: str, alt: dict, now_iso: str) -> dict:
    """Full payload for a new row (no existing record to merge against)."""
    payload: dict[str, Any] = {"business_key": bk, "created_source": "pipeline"}
    for f in SCRAPED_FIELDS:
        v = _coerce(row.get(f))
        if v is not None and f in INT_FIELDS:
            try:
                v = int(float(v))
            except (TypeError, ValueError):
                v = None
        payload[f] = v
    score = _coerce(row.get("priority_score"))
    if score is not None:
        payload["priority_score"] = int(score)
    payload["alt_fields"] = {k: _coerce(v) for k, v in alt.items() if _coerce(v) is not None}
    payload["pipeline_last_seen_at"] = now_iso
    return payload


def _patch_existing(row: dict, existing: dict, alt: dict, now_iso: str) -> dict:
    """Build a PATCH payload for an existing row.

    * Fields present in ``existing.user_overrides`` are skipped (locked).
    * Other scraped fields are overwritten only when the pipeline has a
      truthy value (don't blow away good data with a transient null).
    * ``priority_score`` is refreshed unless user-locked.
    * ``alt_fields`` is always replaced with the latest dedupe snapshot.
    * ``pipeline_last_seen_at`` is touched server-side via an ISO timestamp.
    """
    locks = existing.get("user_overrides") or {}
    patch: dict[str, Any] = {}
    for f in SCRAPED_FIELDS:
        if locks.get(f):
            continue
        v = _coerce(row.get(f))
        if v is not None and f in INT_FIELDS:
            try:
                v = int(float(v))
            except (TypeError, ValueError):
                v = None
        if v is not None:
            patch[f] = v
    if not locks.get("priority_score"):
        score = _coerce(row.get("priority_score"))
        if score is not None:
            patch["priority_score"] = int(score)
    patch["alt_fields"] = {k: _coerce(v) for k, v in alt.items() if _coerce(v) is not None}
    patch["pipeline_last_seen_at"] = now_iso
    return patch


def seed_source_config(client=None) -> None:
    """Idempotent: ensure every scraper has a ``source_config`` row."""
    client = client or _client()
    rows = [{"source_key": k, "enabled": True} for k in SOURCE_KEYS]
    try:
        # upsert with ignoreDuplicates preserves any admin-flipped `enabled`
        client.table("source_config").upsert(
            rows, on_conflict="source_key", ignore_duplicates=True
        ).execute()
    except Exception as e:  # noqa: BLE001
        event_log.error(
            "source_config_seed_failed",
            f"source_config seed failed: {type(e).__name__}: {e}",
            context={"exception": type(e).__name__, "detail": str(e)[:500]},
        )


def read_enabled_sources(client=None) -> set[str]:
    """Return the set of scraper keys whose ``source_config.enabled`` is true.

    Falls back to ``SOURCE_KEYS`` (all enabled) on any error so scraping is
    never silently suppressed by a DB hiccup.
    """
    client = client or _client()
    try:
        res = (
            client.table("source_config")
            .select("source_key, enabled")
            .execute()
        )
        rows = res.data or []
        return {r["source_key"] for r in rows if r.get("enabled")}
    except Exception as e:  # noqa: BLE001
        event_log.error(
            "source_config_read_failed",
            f"source_config read failed: {type(e).__name__}: {e}",
            context={"exception": type(e).__name__},
        )
        return set(SOURCE_KEYS)


def _fetch_existing(client, keys: list[str]) -> dict[str, dict]:
    """Bulk-fetch existing rows keyed by ``business_key``."""
    out: dict[str, dict] = {}
    for i in range(0, len(keys), 500):
        chunk = keys[i : i + 500]
        res = (
            client.table("prospects")
            .select("id,business_key,user_overrides")
            .in_("business_key", chunk)
            .execute()
        )
        for r in res.data or []:
            out[r["business_key"]] = r
    return out


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(min=2, max=20),
    retry=retry_if_exception_type(RETRYABLE_EXCEPTIONS),
    reraise=True,
)
def _insert_batch(client, batch: list[dict]) -> None:
    client.table("prospects").insert(batch).execute()


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(min=2, max=20),
    retry=retry_if_exception_type(RETRYABLE_EXCEPTIONS),
    reraise=True,
)
def _patch_one(client, prospect_id: str, patch: dict) -> None:
    client.table("prospects").update(patch).eq("id", prospect_id).execute()


def sync(rows: Iterable[dict]) -> dict:
    """Upsert ``rows`` into ``public.prospects``.

    Returns a summary dict: ``{'inserted': N, 'updated': N, 'skipped': N,
    'failed': N, 'total': N}``.
    """
    client = _client()
    summary = {"inserted": 0, "updated": 0, "skipped": 0, "failed": 0, "total": 0}

    prepared: list[tuple[str, dict, dict]] = []  # (bk, base_row, alt)
    seen_keys: set[str] = set()
    for row in rows:
        summary["total"] += 1
        bk = business_key(row)
        if not bk:
            summary["skipped"] += 1
            continue
        if bk in seen_keys:
            # dedupe is supposed to have handled this; log and skip the dupe
            event_log.warn(
                "supabase_sync_dupe_key",
                f"duplicate business_key in pipeline batch: {bk}",
                context={"business_key": bk, "company_name": row.get("company_name")},
            )
            summary["skipped"] += 1
            continue
        seen_keys.add(bk)
        base, alt = _split_alt_fields(dict(row))
        prepared.append((bk, base, alt))

    if not prepared:
        return summary

    existing = _fetch_existing(client, [bk for bk, _, _ in prepared])
    now_iso = _utcnow_iso()

    # Split into insert and update buckets
    to_insert: list[dict] = []
    to_update: list[tuple[str, dict]] = []  # (prospect_id, patch)
    for bk, base, alt in prepared:
        if bk in existing:
            patch = _patch_existing(base, existing[bk], alt, now_iso)
            if patch:
                to_update.append((existing[bk]["id"], patch))
            else:
                summary["skipped"] += 1
        else:
            payload = _build_insert(base, bk, alt, now_iso)
            to_insert.append(payload)

    # ---- Inserts (batched) ----
    for i in range(0, len(to_insert), BATCH_SIZE):
        batch = to_insert[i : i + BATCH_SIZE]
        try:
            _insert_batch(client, batch)
            summary["inserted"] += len(batch)
        except Exception as e:  # noqa: BLE001
            summary["failed"] += len(batch)
            event_log.error(
                "supabase_upsert",
                f"insert batch failed after retries: {type(e).__name__}: {e}",
                context={
                    "batch_size": len(batch),
                    "batch_start_key": batch[0].get("business_key") if batch else None,
                    "exception": type(e).__name__,
                    "detail": str(e)[:500],
                    "op": "insert",
                },
            )

    # ---- Updates (per-row PATCH; cheaper for a small diff, safer for retries) ----
    for prospect_id, patch in to_update:
        try:
            _patch_one(client, prospect_id, patch)
            summary["updated"] += 1
        except Exception as e:  # noqa: BLE001
            summary["failed"] += 1
            event_log.error(
                "supabase_upsert",
                f"update failed after retries: {type(e).__name__}: {e}",
                context={
                    "prospect_id": prospect_id,
                    "exception": type(e).__name__,
                    "detail": str(e)[:500],
                    "op": "update",
                },
            )

    return summary
