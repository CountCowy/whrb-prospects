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
from collections.abc import Iterable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from config import (
    PHONE_DIGIT_COUNT,
    SOURCE_KEYS,
    SUPABASE_RETRY_MAX_ATTEMPTS,
    SUPABASE_RETRY_MAX_S,
    SUPABASE_RETRY_MIN_S,
    SUPABASE_UPSERT_BATCH_SIZE,
)
from db.validators import validate_ein, validate_phone
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
    "is_nonprofit",
    "nonprofit_source",
    "ein",
)

# Composite locks: when the key field on the left is locked via
# ``user_overrides``, ALL fields on the right are also skipped at patch time.
# This matches the plan's "if user_overrides contains is_nonprofit, do not
# touch the flag, the EIN, or nonprofit_source" contract.
COMPOSITE_LOCKS: dict[str, tuple[str, ...]] = {
    "is_nonprofit": ("is_nonprofit", "nonprofit_source", "ein"),
}

# Integer columns in public.prospects — pandas floats must be int-coerced.
INT_FIELDS = ("review_count",)

# Fields validated before every upsert. Invalid values become SQL NULL + emit
# a warn event on `event_log`. Counted into SyncSummary["validation_warnings"].
PHONE_FIELDS = ("company_phone", "contact_phone")

# Re-exported for backwards compatibility with scripts that imported it directly.
BATCH_SIZE = SUPABASE_UPSERT_BATCH_SIZE

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
    if phone and len(phone) == PHONE_DIGIT_COUNT:
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
    return datetime.now(tz=UTC).isoformat()


def _apply_field_validators(payload: dict[str, Any], bk: str) -> int:
    """Run per-field validators on the already-coerced payload.

    Mutates ``payload`` in place: invalid ``ein`` / phones become ``None``.
    Returns the count of values that were rejected, so the caller can roll
    it into :data:`SyncSummary.validation_warnings`.
    """
    rejections = 0
    if "ein" in payload and payload.get("ein") is not None:
        original = payload["ein"]
        cleaned = validate_ein(original, business_key=bk)
        if cleaned is None and original is not None:
            rejections += 1
        payload["ein"] = cleaned
    for field in PHONE_FIELDS:
        if payload.get(field) is None:
            continue
        original = payload[field]
        cleaned = validate_phone(original, business_key=bk)
        if cleaned is None and original is not None:
            rejections += 1
        payload[field] = cleaned
    return rejections


def _build_insert(row: dict, bk: str, alt: dict, now_iso: str) -> tuple[dict, int]:
    """Full payload for a new row (no existing record to merge against).

    Returns ``(payload, validation_rejections)``.
    """
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
    rejections = _apply_field_validators(payload, bk)
    return payload, rejections


def _patch_existing(
    row: dict, existing: dict, alt: dict, now_iso: str, bk: str
) -> tuple[dict, int]:
    """Build a PATCH payload for an existing row.

    * Fields present in ``existing.user_overrides`` are skipped (locked).
    * Other scraped fields are overwritten only when the pipeline has a
      truthy value (don't blow away good data with a transient null).
    * ``priority_score`` is refreshed unless user-locked.
    * ``alt_fields`` is always replaced with the latest dedupe snapshot.
    * ``pipeline_last_seen_at`` is touched server-side via an ISO timestamp.

    Returns ``(patch, validation_rejections)``.
    """
    locks = existing.get("user_overrides") or {}
    # Expand composite locks (e.g. is_nonprofit locks nonprofit_source + ein).
    effective_locks: set[str] = {k for k, v in locks.items() if v}
    for trigger, covered in COMPOSITE_LOCKS.items():
        if locks.get(trigger):
            effective_locks.update(covered)
    patch: dict[str, Any] = {}
    for f in SCRAPED_FIELDS:
        if f in effective_locks:
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
    rejections = _apply_field_validators(patch, bk)
    return patch, rejections


def seed_source_config(client=None) -> None:
    """Idempotent: ensure every scraper has a ``source_config`` row."""
    client = client or _client()
    rows = [{"source_key": k, "enabled": True} for k in SOURCE_KEYS]
    try:
        # upsert with ignoreDuplicates preserves any admin-flipped `enabled`
        client.table("source_config").upsert(
            rows, on_conflict="source_key", ignore_duplicates=True
        ).execute()
    except Exception as e:
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
    except Exception as e:
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
    stop=stop_after_attempt(SUPABASE_RETRY_MAX_ATTEMPTS),
    wait=wait_exponential(min=SUPABASE_RETRY_MIN_S, max=SUPABASE_RETRY_MAX_S),
    retry=retry_if_exception_type(RETRYABLE_EXCEPTIONS),
    reraise=True,
)
def _insert_batch(client, batch: list[dict]) -> None:
    client.table("prospects").insert(batch).execute()


@retry(
    stop=stop_after_attempt(SUPABASE_RETRY_MAX_ATTEMPTS),
    wait=wait_exponential(min=SUPABASE_RETRY_MIN_S, max=SUPABASE_RETRY_MAX_S),
    retry=retry_if_exception_type(RETRYABLE_EXCEPTIONS),
    reraise=True,
)
def _patch_one(client, prospect_id: str, patch: dict) -> None:
    client.table("prospects").update(patch).eq("id", prospect_id).execute()


def sync(rows: Iterable[dict]) -> dict:
    """Upsert ``rows`` into ``public.prospects``.

    Returns a summary dict: ``{'inserted': N, 'updated': N, 'skipped': N,
    'failed': N, 'validation_warnings': N, 'total': N}``. ``validation_warnings``
    counts per-field rejections surfaced by :mod:`db.validators` (malformed
    EIN / phone); each rejection also emits a ``warn`` event on ``event_log``.
    """
    client = _client()
    summary = {
        "inserted": 0,
        "updated": 0,
        "skipped": 0,
        "failed": 0,
        "validation_warnings": 0,
        "total": 0,
    }

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
            patch, rejections = _patch_existing(base, existing[bk], alt, now_iso, bk)
            summary["validation_warnings"] += rejections
            if patch:
                to_update.append((existing[bk]["id"], patch))
            else:
                summary["skipped"] += 1
        else:
            payload, rejections = _build_insert(base, bk, alt, now_iso)
            summary["validation_warnings"] += rejections
            to_insert.append(payload)

    # ---- Inserts (batched) ----
    for i in range(0, len(to_insert), BATCH_SIZE):
        batch = to_insert[i : i + BATCH_SIZE]
        try:
            _insert_batch(client, batch)
            summary["inserted"] += len(batch)
        except Exception as e:
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
        except Exception as e:
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


# ------------------------------------------------------------------------- #
# Stage T2 — tag sync (phase 08_b_tag_sync)                                 #
# ------------------------------------------------------------------------- #

# Tag-sync is additive: the pipeline NEVER DELETEs a prospect_tags row.
# Behaviour contract (plan §4.4 / §4.5 / §1.3 #23-#24):
#
#   - Resolve each emitted row's business_key → prospect_id via the existing
#     prospects table.
#   - Resolve each (axis, value) → tag_id via tag_vocabulary (cached).
#   - Emit-with-on-conflict-do-nothing into prospect_tags. Pipeline rows
#     carry created_by=NULL; the unique (prospect_id, tag_id) constraint
#     makes the insert idempotent.
#   - Compliance axis + suppressed_at-not-null row: re-emission is a no-op
#     and emits category='compliance_resuppressed'. Non-compliance
#     suppressed rows are impossible in v1 (suppression only applies to
#     compliance) but the branch handles the general case.
#   - Per-tag locks (locked_by not null): the pipeline INSERT alongside
#     with the same axis is legal and by design (T09a). It's only a
#     conflict on (prospect_id, tag_id) — i.e. the same value — which the
#     unique constraint already dedupes.
#
# The emitter dict shape in ``rows`` is ``row['tags'] = {axis: [values]}``.

# Per-batch retry reuses the same tenacity config as the prospects upsert.
@retry(
    stop=stop_after_attempt(SUPABASE_RETRY_MAX_ATTEMPTS),
    wait=wait_exponential(min=SUPABASE_RETRY_MIN_S, max=SUPABASE_RETRY_MAX_S),
    retry=retry_if_exception_type(RETRYABLE_EXCEPTIONS),
    reraise=True,
)
def _insert_tag_batch(client, batch: list[dict]) -> None:
    # Supabase Postgrest translates ``on_conflict`` into
    # `INSERT ... ON CONFLICT DO NOTHING` when ``ignore_duplicates=True``
    # so a re-emitted (prospect_id, tag_id) pair is a no-op.
    (
        client.table("prospect_tags")
        .upsert(
            batch,
            on_conflict="prospect_id,tag_id",
            ignore_duplicates=True,
        )
        .execute()
    )


def _load_vocab_lookup(client) -> dict[tuple[str, str], str]:
    """Return a ``{(axis, value): tag_id}`` map for every active vocab row.

    T2's tag sync treats deprecated vocab as read-only — a row in
    ``prospect_tags`` referencing a deprecated tag is still valid (admins
    use ``status=deprecated + replacement_id`` to signal migration intent),
    but the pipeline never emits new references to deprecated values.
    """
    rows = (
        client.table("tag_vocabulary")
        .select("id,axis,value,status")
        .eq("status", "active")
        .execute()
        .data
        or []
    )
    return {(r["axis"], r["value"]): r["id"] for r in rows}


def _fetch_prospect_ids_for_keys(
    client, business_keys: list[str]
) -> dict[str, str]:
    out: dict[str, str] = {}
    for i in range(0, len(business_keys), 500):
        chunk = business_keys[i : i + 500]
        res = (
            client.table("prospects")
            .select("id,business_key")
            .in_("business_key", chunk)
            .execute()
        )
        for r in res.data or []:
            out[r["business_key"]] = r["id"]
    return out


def _fetch_suppressed_compliance_rows(
    client, prospect_ids: list[str], tag_ids: list[str]
) -> set[tuple[str, str]]:
    """Return the set of ``(prospect_id, tag_id)`` pairs with suppressed_at set.

    Queries prospect_tags with a partial predicate matching the candidate
    emit set; Postgres uses ``idx_prospect_tags_suppressed`` when it
    applies. Returned tuples are strings so they can be looked up with
    the same tuple shape the emit loop constructs.
    """
    if not prospect_ids or not tag_ids:
        return set()
    out: set[tuple[str, str]] = set()
    # Chunk the prospect_ids — tag_ids are smaller (bounded by the emit set)
    # but prospect_ids can grow to thousands on a full rerun.
    for i in range(0, len(prospect_ids), 500):
        chunk = prospect_ids[i : i + 500]
        res = (
            client.table("prospect_tags")
            .select("prospect_id,tag_id")
            .not_.is_("suppressed_at", "null")
            .in_("prospect_id", chunk)
            .in_("tag_id", tag_ids)
            .execute()
        )
        for r in res.data or []:
            out.add((r["prospect_id"], r["tag_id"]))
    return out


def tag_sync(rows: Iterable[dict], *, client=None) -> dict:
    """Phase 08_b_tag_sync — populate prospect_tags from the in-memory rows.

    Returns a summary: ``{'added', 'preserved', 'lock_skipped',
    'compliance_resuppressed', 'vocab_miss', 'failed', 'total'}``.
      * ``added`` — INSERT succeeded (new (prospect_id, tag_id) pair).
      * ``preserved`` — unique-constraint no-op (pair already present).
      * ``compliance_resuppressed`` — the row already exists with
        suppressed_at set and axis='compliance'; we emit the
        resuppression event and skip.
      * ``vocab_miss`` — emitted (axis, value) not in active vocab; event
        logged; emitter-side strict mode is the primary safety net.
      * ``lock_skipped`` — reserved for future (no delete path in v1; the
        plan's T09c/T09g lock-deletion tests are RLS-gated at the web
        tier, not this phase).
      * ``failed`` — batch insert exhausted retries.
    """
    client = client or _client()
    summary = {
        "added": 0,
        "preserved": 0,
        "lock_skipped": 0,
        "compliance_resuppressed": 0,
        "vocab_miss": 0,
        "failed": 0,
        "total": 0,
    }

    vocab = _load_vocab_lookup(client)

    # Collect the (business_key, tag) pairs we intend to emit.
    rows_list = [dict(r) for r in rows]
    emit_by_key: dict[str, set[tuple[str, str]]] = {}
    for row in rows_list:
        tags = row.get("tags") or {}
        if not tags:
            continue
        bk = business_key(row)
        if not bk:
            continue
        pairs = emit_by_key.setdefault(bk, set())
        for axis, values in tags.items():
            if not values:
                continue
            for v in values:
                summary["total"] += 1
                if (axis, v) not in vocab:
                    summary["vocab_miss"] += 1
                    event_log.warn(
                        "tag_vocab_miss",
                        f"sync vocab miss {axis}:{v}",
                        context={
                            "axis": axis,
                            "value": v,
                            "business_key": bk,
                            "phase": "08_b_tag_sync",
                        },
                    )
                    continue
                pairs.add((axis, v))
    if not emit_by_key:
        return summary

    # Resolve business_key -> prospect_id. Rows whose prospects didn't
    # persist (e.g. sync failed earlier) are dropped silently; their tags
    # will land on the next successful rerun.
    bk_to_id = _fetch_prospect_ids_for_keys(client, list(emit_by_key))

    # Flatten to (prospect_id, tag_id, axis) triples so compliance
    # suppression checks are O(1).
    triples: list[tuple[str, str, str, str]] = []  # (prospect_id, tag_id, axis, value)
    prospect_ids_in_batch: set[str] = set()
    tag_ids_in_batch: set[str] = set()
    for bk, pairs in emit_by_key.items():
        pid = bk_to_id.get(bk)
        if not pid:
            continue
        for axis, value in pairs:
            tag_id = vocab.get((axis, value))
            if not tag_id:
                continue
            triples.append((pid, tag_id, axis, value))
            prospect_ids_in_batch.add(pid)
            tag_ids_in_batch.add(tag_id)

    if not triples:
        return summary

    # Resolve the suppressed set for this emit batch.
    suppressed = _fetch_suppressed_compliance_rows(
        client, list(prospect_ids_in_batch), list(tag_ids_in_batch)
    )

    # Split into immediate-insert and compliance-resuppressed buckets.
    to_insert: list[dict] = []
    for pid, tid, axis, value in triples:
        if (pid, tid) in suppressed:
            if axis == "compliance":
                summary["compliance_resuppressed"] += 1
                event_log.info(
                    "compliance_resuppressed",
                    f"compliance re-emission suppressed for "
                    f"prospect {pid} ({axis}:{value})",
                    context={
                        "prospect_id": pid,
                        "tag_id": tid,
                        "axis": axis,
                        "value": value,
                    },
                )
            else:
                # Non-compliance suppression is not a v1 code path; log
                # it anyway so it's visible if the web UI ever grows the
                # feature.
                summary["compliance_resuppressed"] += 1
                event_log.info(
                    "tag_suppressed",
                    f"non-compliance re-emission suppressed for "
                    f"prospect {pid} ({axis}:{value})",
                    context={
                        "prospect_id": pid,
                        "tag_id": tid,
                        "axis": axis,
                        "value": value,
                    },
                )
            continue
        to_insert.append({
            "prospect_id": pid,
            "tag_id": tid,
            "created_by": None,
        })

    # Pre-count how many of these already exist so the summary reflects
    # preserved-vs-added accurately. Cheap per-emit-batch existence query.
    existing_pairs: set[tuple[str, str]] = set()
    if to_insert:
        ids = list({t["prospect_id"] for t in to_insert})
        tids = list({t["tag_id"] for t in to_insert})
        for i in range(0, len(ids), 500):
            chunk = ids[i : i + 500]
            res = (
                client.table("prospect_tags")
                .select("prospect_id,tag_id")
                .in_("prospect_id", chunk)
                .in_("tag_id", tids)
                .execute()
            )
            for r in res.data or []:
                existing_pairs.add((r["prospect_id"], r["tag_id"]))

    # Submit inserts in batches — ON CONFLICT DO NOTHING handles the
    # already-present rows. We keep the batch size aligned with upsert.
    for i in range(0, len(to_insert), SUPABASE_UPSERT_BATCH_SIZE):
        batch = to_insert[i : i + SUPABASE_UPSERT_BATCH_SIZE]
        try:
            _insert_tag_batch(client, batch)
        except Exception as e:
            summary["failed"] += len(batch)
            event_log.error(
                "tag_sync",
                f"tag batch insert failed after retries: "
                f"{type(e).__name__}: {e}",
                context={
                    "batch_size": len(batch),
                    "exception": type(e).__name__,
                    "detail": str(e)[:500],
                },
            )
            continue
        # Batch succeeded — partition into added vs preserved using the
        # existing_pairs precount.
        for rec in batch:
            if (rec["prospect_id"], rec["tag_id"]) in existing_pairs:
                summary["preserved"] += 1
            else:
                summary["added"] += 1

    event_log.info(
        "tag_sync",
        "tag sync complete",
        context=dict(summary),
    )
    return summary
