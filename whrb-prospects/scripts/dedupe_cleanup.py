#!/usr/bin/env python3
"""dedupe_cleanup.py — one-shot merge of duplicate prospects.

The Reagle Music Theater bug (April 2026): every pipeline run that scraped a
fresh hallucinated phone for the same venue produced a brand-new
``business_key`` (e.g. ``phone:1145128678``, ``phone:5275619254``) instead of
patching the existing row. Five separate runs left five identical-looking
prospects in ``public.prospects``. The same pattern hit 254 name-clusters
across the live DB.

The new code-side fix (db/validators.py NANP allowlist + sync()
cross-run lookup) prevents future duplicates. This script repairs the
existing 431 duplicate rows already in the DB.

What it does
------------
1. Groups every row in ``public.prospects`` by normalized company name
   (``enrich.dedupe._norm_name``).
2. Splits each multi-row group into one of:
   * **MERGE** — same business, multiple rows. Picks a canonical row and
     repoints every child FK (notes, tags, contact emails, notifications,
     filter impressions) onto the canonical, then hard-deletes the losers.
   * **SKIP_CHAIN** — distinct physical locations sharing a name (Starbucks,
     Tatte, Ben & Jerry's). Different ZIPs + valid NANP phones across the
     cluster. Per the user's confirmed decision: leave these alone.
3. Writes a JSON report covering every cluster (merge plan or chain skip).

The script defaults to ``--dry-run``. ``--apply`` performs the writes.

Usage
-----
``.venv/bin/python scripts/dedupe_cleanup.py            # dry-run, default``
``.venv/bin/python scripts/dedupe_cleanup.py --apply    # perform merges``
``.venv/bin/python scripts/dedupe_cleanup.py --limit 5  # cap at 5 clusters``
``.venv/bin/python scripts/dedupe_cleanup.py --report-out path.json``
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from supabase import create_client

HERE = Path(__file__).resolve().parent
WHRB = HERE.parent
sys.path.insert(0, str(WHRB))
load_dotenv(WHRB / ".env")

# Late imports so sys.path is set first.
from db.supabase_sync import business_key
from db.validators import VALID_NANP_AREA_CODES
from enrich.dedupe import _norm_name
from util import event_log

SUPABASE_URL = os.environ["SUPABASE_URL"]
SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

DEFAULT_REPORT = WHRB / "output" / "dedupe_cleanup_report.json"

# Tables that carry a ``prospect_id`` FK referencing ``prospects(id)``. Each
# loser row's children must be repointed (or in the case of presence,
# discarded) before the loser can be deleted. Order matters only insofar as
# we want the unique-constraint conflicts to be handled before the parent
# delete fires — every CASCADE is safe regardless.
CHILD_TABLES_TO_REPOINT: tuple[tuple[str, set[str]], ...] = (
    # (table_name, unique-conflict columns to dedupe on before INSERT)
    ("prospect_notes", set()),  # no UNIQUE on (prospect_id, ...) — safe blanket repoint
    ("prospect_tags", {"tag_id"}),  # UNIQUE (prospect_id, tag_id)
    ("prospect_contact_emails", {"email_lower"}),  # UNIQUE (prospect_id, lower(email))
    ("notifications", set()),
    ("filter_impressions", {"user_id", "impression_date"}),  # partial UNIQUE
    ("filter_impression_stats", {"user_id", "week_start"}),  # composite PK
)

CHAIN_CHECK_MIN_VALID = 2  # cluster needs ≥2 valid-NANP rows to be a chain
CHAIN_CHECK_MIN_DISTINCT_ZIPS = 2


def _client():
    return create_client(SUPABASE_URL, SERVICE_KEY)


# ---------------------------------------------------------------------------
# Read phase
# ---------------------------------------------------------------------------


def fetch_all_prospects(client) -> list[dict]:
    """Page through every prospect with the columns we need to score + merge."""
    out: list[dict] = []
    page, offset = 1000, 0
    cols = (
        "id,business_key,company_name,zip,company_phone,contact_phone,"
        "priority_score,created_at,assigned_to,state,user_overrides,"
        "alt_fields,contact_email_count,created_source,pipeline_last_seen_at"
    )
    while True:
        res = (
            client.table("prospects")
            .select(cols)
            .range(offset, offset + page - 1)
            .execute()
        )
        rows = res.data or []
        out.extend(rows)
        if len(rows) < page:
            break
        offset += page
    return out


def fetch_notes_counts(client, prospect_ids: list[str]) -> dict[str, int]:
    """Return {prospect_id: notes_count_excluding_soft_deleted}.

    Sized for the cluster scoring step — only call for the prospect ids that
    appear in non-trivial clusters (size ≥ 2), not the whole table.
    """
    out: dict[str, int] = {pid: 0 for pid in prospect_ids}
    if not prospect_ids:
        return out
    for i in range(0, len(prospect_ids), 500):
        chunk = prospect_ids[i : i + 500]
        res = (
            client.table("prospect_notes")
            .select("id,prospect_id,deleted_at")
            .in_("prospect_id", chunk)
            .execute()
        )
        for row in res.data or []:
            if row.get("deleted_at") is None:
                out[row["prospect_id"]] = out.get(row["prospect_id"], 0) + 1
    return out


# ---------------------------------------------------------------------------
# Cluster classification
# ---------------------------------------------------------------------------


def is_nanp_valid_key(bk: str) -> bool:
    """True if a ``phone:<10digit>`` key has a real NANP area code, or if it's
    a ``name:`` key (those weren't generated from a hallucinated phone).
    """
    if not bk:
        return False
    if bk.startswith("name:"):
        return True
    if bk.startswith("phone:"):
        digits = bk[len("phone:"):]
        return len(digits) == 10 and digits.isdigit() and digits[:3] in VALID_NANP_AREA_CODES
    return False


def classify_cluster(rows: list[dict]) -> dict[str, Any]:
    """Decide whether a same-name cluster is one business or a chain.

    Returns ``{"action": "merge"|"skip_chain", "reason": str, ...}``.
    """
    distinct_zips: set[str] = set()
    valid_count = 0
    for r in rows:
        z = (r.get("zip") or "").strip()[:5]
        if z:
            distinct_zips.add(z)
        if is_nanp_valid_key(r.get("business_key", "")):
            valid_count += 1

    # Single-zip clusters are always one business (artsboston pattern).
    if len(distinct_zips) <= 1:
        return {
            "action": "merge",
            "reason": "single_zip_or_none",
            "distinct_zips": sorted(distinct_zips),
            "nanp_valid_count": valid_count,
        }

    # Multi-zip cluster with at most one NANP-valid phone: the others are
    # almost certainly hallucinations of the same venue. Merge.
    if valid_count <= 1:
        return {
            "action": "merge",
            "reason": "multi_zip_but_single_valid_phone",
            "distinct_zips": sorted(distinct_zips),
            "nanp_valid_count": valid_count,
        }

    # Multi-zip cluster with multiple NANP-valid rows: chain (Starbucks).
    if (
        len(distinct_zips) >= CHAIN_CHECK_MIN_DISTINCT_ZIPS
        and valid_count >= CHAIN_CHECK_MIN_VALID
    ):
        return {
            "action": "skip_chain",
            "reason": "multi_zip_multi_valid_phones",
            "distinct_zips": sorted(distinct_zips),
            "nanp_valid_count": valid_count,
        }

    # Defensive default: skip and let a human eyeball it.
    return {
        "action": "skip_chain",
        "reason": "ambiguous",
        "distinct_zips": sorted(distinct_zips),
        "nanp_valid_count": valid_count,
    }


# ---------------------------------------------------------------------------
# Canonical-row scoring
# ---------------------------------------------------------------------------


def canonical_score(row: dict, notes_count: int) -> int:
    """Higher = more user activity / quality => keep this row.

    Weights mirror the plan's signal table in §3.
    """
    score = 0
    overrides = row.get("user_overrides") or {}
    truthy_locks = sum(1 for v in overrides.values() if v)
    score += 100 * truthy_locks
    if row.get("assigned_to"):
        score += 50
    if (row.get("state") or "researching") != "researching":
        score += 30
    score += 5 * notes_count
    score += 2 * (row.get("contact_email_count") or 0)
    if row.get("created_source") == "manual":
        score += 10
    return score


def pick_canonical(
    rows: list[dict], notes_counts: dict[str, int]
) -> tuple[dict, list[dict], dict[str, int]]:
    """Sort cluster rows by score (desc) then created_at (asc, oldest first)."""
    scored = [
        (canonical_score(r, notes_counts.get(r["id"], 0)), r.get("created_at") or "", r)
        for r in rows
    ]
    scored.sort(key=lambda t: (-t[0], t[1]))
    canonical = scored[0][2]
    losers = [t[2] for t in scored[1:]]
    score_map = {r["id"]: s for s, _, r in scored}
    return canonical, losers, score_map


# ---------------------------------------------------------------------------
# Merge phase (only runs under --apply)
# ---------------------------------------------------------------------------


def _merge_user_overrides(canonical: dict, losers: list[dict]) -> dict:
    merged: dict[str, Any] = dict(canonical.get("user_overrides") or {})
    for loser in losers:
        for k, v in (loser.get("user_overrides") or {}).items():
            if v and not merged.get(k):
                merged[k] = v
    return merged


def _merge_alt_fields(canonical: dict, losers: list[dict]) -> dict:
    merged: dict[str, Any] = dict(canonical.get("alt_fields") or {})
    for loser in losers:
        for k, v in (loser.get("alt_fields") or {}).items():
            if v is not None and merged.get(k) in (None, ""):
                merged[k] = v
    return merged


def _regenerate_canonical_business_key(canonical: dict) -> str:
    """Compute the canonical's business_key from its current row data.

    The existing key may be a stale hallucination — e.g., Reagle's canonical
    carries ``phone:7817010750`` from a long-gone scrape but the user-locked
    ``contact_phone`` is now ``781-891-5600``. Without regeneration, a
    future pipeline run that produces the *real* phone would key as
    ``phone:7818915600``, miss the canonical, and insert a duplicate. Pass
    the canonical through the new NANP-aware business_key() so its key
    matches the data it actually represents.

    Falls back to the existing key if business_key() returns None (i.e.,
    the canonical somehow has no usable name or phone).
    """
    fresh = business_key(canonical)
    if fresh:
        return fresh
    return str(canonical.get("business_key") or "")


def _repoint_prospect_notes(client, loser_id: str, canonical_id: str) -> int:
    """Move every note from loser_id to canonical_id. No conflict semantics —
    notes are a free-form append-only log."""
    res = (
        client.table("prospect_notes")
        .update({"prospect_id": canonical_id})
        .eq("prospect_id", loser_id)
        .execute()
    )
    return len(res.data or [])


def _repoint_prospect_tags(client, loser_id: str, canonical_id: str) -> int:
    """Move tag rows from loser_id to canonical_id, dropping (canonical_id,
    tag_id) duplicates that the UNIQUE constraint would reject.

    Strategy: read the loser's tag_ids and the canonical's tag_ids, compute
    the symmetric difference (loser-only), update those rows. The tags that
    overlap stay on the loser and cascade-delete with it.
    """
    loser_res = (
        client.table("prospect_tags")
        .select("id,tag_id")
        .eq("prospect_id", loser_id)
        .execute()
    )
    loser_tags = {r["tag_id"]: r["id"] for r in (loser_res.data or [])}
    if not loser_tags:
        return 0
    canonical_res = (
        client.table("prospect_tags")
        .select("tag_id")
        .eq("prospect_id", canonical_id)
        .execute()
    )
    canonical_tag_ids = {r["tag_id"] for r in (canonical_res.data or [])}
    repoint_ids = [loser_tags[t] for t in loser_tags if t not in canonical_tag_ids]
    if not repoint_ids:
        return 0
    for i in range(0, len(repoint_ids), 200):
        chunk = repoint_ids[i : i + 200]
        (
            client.table("prospect_tags")
            .update({"prospect_id": canonical_id})
            .in_("id", chunk)
            .execute()
        )
    return len(repoint_ids)


def _repoint_prospect_contact_emails(client, loser_id: str, canonical_id: str) -> int:
    """Move email rows; drop (canonical_id, lower(email)) duplicates.

    Same strategy as tags — fetch both sides, compute the loser-only diff,
    update those. Forces ``is_primary=false`` on every repointed row because
    the canonical already has its own ``is_primary=true`` email (per the
    ``uniq_prospect_primary_email`` partial UNIQUE on
    (prospect_id) WHERE is_primary). Loser-origin emails become secondaries.
    """
    loser_res = (
        client.table("prospect_contact_emails")
        .select("id,email")
        .eq("prospect_id", loser_id)
        .execute()
    )
    loser_emails = {(r["email"] or "").lower(): r["id"] for r in (loser_res.data or [])}
    if not loser_emails:
        return 0
    canonical_res = (
        client.table("prospect_contact_emails")
        .select("email")
        .eq("prospect_id", canonical_id)
        .execute()
    )
    canonical_emails_lower = {(r["email"] or "").lower() for r in (canonical_res.data or [])}
    repoint_ids = [
        eid for em, eid in loser_emails.items() if em and em not in canonical_emails_lower
    ]
    if not repoint_ids:
        return 0
    moved = 0
    for eid in repoint_ids:
        try:
            (
                client.table("prospect_contact_emails")
                .update({"prospect_id": canonical_id, "is_primary": False})
                .eq("id", eid)
                .execute()
            )
            moved += 1
        except Exception as exc:
            event_log.warn(
                "dedupe_cleanup_email_repoint_failed",
                f"email row {eid} loser={loser_id} -> canonical={canonical_id}: {exc}",
                context={
                    "row_id": eid,
                    "loser_id": loser_id,
                    "canonical_id": canonical_id,
                    "exception": type(exc).__name__,
                },
            )
    return moved


def _repoint_simple(client, table: str, loser_id: str, canonical_id: str) -> int:
    """Blanket UPDATE for tables without a unique-constraint conflict risk."""
    res = (
        client.table(table)
        .update({"prospect_id": canonical_id})
        .eq("prospect_id", loser_id)
        .execute()
    )
    return len(res.data or [])


def _delete_loser_presence(client, loser_id: str) -> None:
    """Presence rows are heartbeats; nothing to merge. Cascade will also
    handle this when the prospect deletes, but we drop them explicitly so
    the merge is order-independent."""
    (
        client.table("prospect_presence")
        .delete()
        .eq("prospect_id", loser_id)
        .execute()
    )


def _update_canonical(
    client,
    canonical_id: str,
    new_user_overrides: dict,
    new_alt_fields: dict,
    new_business_key: str,
    old_business_key: str,
) -> None:
    safe_patch: dict[str, Any] = {
        "user_overrides": new_user_overrides,
        "alt_fields": new_alt_fields,
    }
    if new_business_key and new_business_key != old_business_key:
        # Try the full patch (including the business_key change) first. If
        # the regenerated key collides with another canonical (rare —
        # implies two same-named clusters that the chain heuristic should
        # have classified together), fall back to the safe patch and log.
        try:
            (
                client.table("prospects")
                .update({**safe_patch, "business_key": new_business_key})
                .eq("id", canonical_id)
                .execute()
            )
            return
        except Exception as exc:  # supabase-py raises bare Exception on conflict
            event_log.warn(
                "dedupe_cleanup_bk_collision",
                f"business_key {new_business_key!r} collided; canonical "
                f"{canonical_id} keeps its old key {old_business_key!r}",
                context={
                    "canonical_id": canonical_id,
                    "attempted_key": new_business_key,
                    "old_key": old_business_key,
                    "exception": type(exc).__name__,
                },
            )
    (
        client.table("prospects")
        .update(safe_patch)
        .eq("id", canonical_id)
        .execute()
    )


def _delete_loser(client, loser_id: str) -> None:
    client.table("prospects").delete().eq("id", loser_id).execute()


def apply_merge(
    client,
    canonical: dict,
    losers: list[dict],
    new_user_overrides: dict,
    new_alt_fields: dict,
    new_business_key: str,
) -> dict[str, int]:
    """Perform the merge for one cluster. Returns child-row repoint counts."""
    counts: defaultdict[str, int] = defaultdict(int)
    canonical_id = canonical["id"]
    for loser in losers:
        loser_id = loser["id"]
        counts["prospect_notes"] += _repoint_prospect_notes(client, loser_id, canonical_id)
        counts["prospect_tags"] += _repoint_prospect_tags(client, loser_id, canonical_id)
        counts["prospect_contact_emails"] += _repoint_prospect_contact_emails(
            client, loser_id, canonical_id
        )
        for tbl in ("notifications", "filter_impressions", "filter_impression_stats"):
            try:
                counts[tbl] += _repoint_simple(client, tbl, loser_id, canonical_id)
            except Exception as exc:
                # Best-effort: a uniqueness conflict on filter_impressions is
                # benign (the loser's stats simply vanish with the cascade).
                event_log.warn(
                    "dedupe_cleanup_repoint_failed",
                    f"{tbl} repoint loser={loser_id} -> canonical={canonical_id}: {exc}",
                    context={"table": tbl, "loser_id": loser_id, "canonical_id": canonical_id},
                )
        _delete_loser_presence(client, loser_id)
    _update_canonical(
        client,
        canonical_id,
        new_user_overrides,
        new_alt_fields,
        new_business_key,
        canonical.get("business_key", ""),
    )
    for loser in losers:
        _delete_loser(client, loser["id"])
    return dict(counts)


# ---------------------------------------------------------------------------
# Driver
# ---------------------------------------------------------------------------


def build_plan(rows: list[dict], notes_counts: dict[str, int]) -> dict[str, Any]:
    """Group + classify + score every cluster. No DB writes."""
    by_norm_name: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        n = _norm_name(r.get("company_name"))
        if not n:
            continue
        by_norm_name[n].append(r)

    merge_plan: list[dict] = []
    skip_plan: list[dict] = []
    for n, cluster in by_norm_name.items():
        if len(cluster) < 2:
            continue
        verdict = classify_cluster(cluster)
        if verdict["action"] == "skip_chain":
            skip_plan.append({
                "name": cluster[0].get("company_name"),
                "row_count": len(cluster),
                "distinct_zips": verdict["distinct_zips"],
                "reason": verdict["reason"],
                "ids": [r["id"] for r in cluster],
            })
            continue
        canonical, losers, score_map = pick_canonical(cluster, notes_counts)
        new_overrides = _merge_user_overrides(canonical, losers)
        new_alt = _merge_alt_fields(canonical, losers)
        new_bk = _regenerate_canonical_business_key({**canonical, "user_overrides": new_overrides})
        merge_plan.append({
            "name": canonical.get("company_name"),
            "norm_name": n,
            "cluster_size": len(cluster),
            "reason": verdict["reason"],
            "canonical": {
                "id": canonical["id"],
                "business_key": canonical.get("business_key"),
                "new_business_key": new_bk,
                "score": score_map[canonical["id"]],
                "zip": canonical.get("zip"),
                "user_overrides": canonical.get("user_overrides") or {},
            },
            "losers": [
                {
                    "id": l["id"],
                    "business_key": l.get("business_key"),
                    "score": score_map[l["id"]],
                    "zip": l.get("zip"),
                    "nanp_valid_phone_key": is_nanp_valid_key(l.get("business_key", "")),
                    "user_overrides": l.get("user_overrides") or {},
                }
                for l in losers
            ],
            "user_overrides_union": sorted(k for k, v in new_overrides.items() if v),
            "alt_fields_union_keys": sorted(new_alt.keys()),
        })
    return {"merges": merge_plan, "skipped_chains": skip_plan}


def run(args: argparse.Namespace) -> int:
    client = _client()
    print(f"[dedupe_cleanup] reading prospects from {SUPABASE_URL} …", file=sys.stderr)
    rows = fetch_all_prospects(client)
    print(f"[dedupe_cleanup] fetched {len(rows)} prospects", file=sys.stderr)

    # Pre-fetch notes counts only for ids that appear in size-≥2 clusters.
    by_norm_name_pre: dict[str, list[str]] = defaultdict(list)
    for r in rows:
        n = _norm_name(r.get("company_name"))
        if n:
            by_norm_name_pre[n].append(r["id"])
    cluster_ids = [pid for ids in by_norm_name_pre.values() if len(ids) > 1 for pid in ids]
    print(f"[dedupe_cleanup] fetching notes counts for {len(cluster_ids)} clustered ids …",
          file=sys.stderr)
    notes_counts = fetch_notes_counts(client, cluster_ids)

    plan = build_plan(rows, notes_counts)
    if args.limit is not None:
        plan["merges"] = plan["merges"][: args.limit]

    summary: dict[str, Any] = {
        "total_prospects": len(rows),
        "clusters_total": len(plan["merges"]) + len(plan["skipped_chains"]),
        "clusters_to_merge": len(plan["merges"]),
        "clusters_skipped_chain": len(plan["skipped_chains"]),
        "rows_to_delete": sum(len(m["losers"]) for m in plan["merges"]),
        "applied": False,
    }
    plan["summary"] = summary

    if args.apply:
        print(f"[dedupe_cleanup] APPLYING {summary['clusters_to_merge']} merges "
              f"({summary['rows_to_delete']} rows to delete) …", file=sys.stderr)
        applied_counts: dict[str, int] = defaultdict(int)
        for merged_clusters, m in enumerate(plan["merges"], start=1):
            canonical_obj = next(r for r in rows if r["id"] == m["canonical"]["id"])
            loser_objs = [next(r for r in rows if r["id"] == l["id"]) for l in m["losers"]]
            new_overrides = _merge_user_overrides(canonical_obj, loser_objs)
            new_alt = _merge_alt_fields(canonical_obj, loser_objs)
            new_bk = m["canonical"]["new_business_key"]
            counts = apply_merge(
                client, canonical_obj, loser_objs, new_overrides, new_alt, new_bk
            )
            for k, v in counts.items():
                applied_counts[k] += v
            event_log.info(
                "dedupe_cleanup_merge",
                f"merged {m['cluster_size']} rows for {m['name']!r}",
                context={
                    "canonical_id": m["canonical"]["id"],
                    "loser_ids": [l["id"] for l in m["losers"]],
                    "cluster_size": m["cluster_size"],
                    "user_overrides_union": m["user_overrides_union"],
                },
            )
            if merged_clusters % 25 == 0:
                print(f"  … merged {merged_clusters}/{summary['clusters_to_merge']}",
                      file=sys.stderr)
        summary["applied"] = True
        summary["applied_counts"] = dict(applied_counts)
        event_log.flush()

    args.report_out.parent.mkdir(parents=True, exist_ok=True)
    args.report_out.write_text(json.dumps(plan, indent=2, default=str))
    print(f"[dedupe_cleanup] report written to {args.report_out}", file=sys.stderr)
    print(f"[dedupe_cleanup] summary: {json.dumps(summary, indent=2)}", file=sys.stderr)
    return 0


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument(
        "--apply", action="store_true",
        help="Actually perform the merges. Without this flag the script only "
             "writes the JSON plan and exits.",
    )
    p.add_argument("--limit", type=int, default=None,
                   help="Cap the number of merge clusters processed (testing).")
    p.add_argument("--report-out", type=Path, default=DEFAULT_REPORT,
                   help=f"Where to write the JSON plan/report (default: {DEFAULT_REPORT}).")
    args = p.parse_args()
    return run(args)


if __name__ == "__main__":
    sys.exit(main())
