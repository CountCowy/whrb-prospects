#!/usr/bin/env python3
"""Stage T3 — daily digest of pending tag-vocab notifications.

Processes every admin's `notifications` inbox for kind=`tag_vocab_pending`
rows whose `digested_at` is NULL. Routes per `profiles.vocab_notify_mode`:

  - `digest_daily` (default): aggregate pending vocab values into a
    summary, mark each row's `digested_at = now()`, log a summary
    `event_log.category='vocab_digest_summary'` row. Email delivery
    path is a TODO for Stage 11 (Resend wiring); the in-app row was
    already delivered by the `on_pending_tag_use` /
    `on_rep_tag_vocab_insert` triggers.
  - `instant`: same digestion stamp without aggregation. The "instant"
    label refers to email delivery latency (TODO Stage 11); in-app
    delivery is identical for both modes.
  - `digest_off`: mark `digested_at = now()` without logging anything
    user-facing — admin must visit `/admin/vocab` to see the pending
    inbox.

Compliance-axis rows (`payload->>'axis' = 'compliance'`) are excluded
entirely. Plan §1.3 #6 + §5.4: those bypass the digest cadence and
remain in the inbox until manually read or actioned.

Idempotent: a same-day re-run finds no rows with `digested_at IS NULL`
and no-ops. Compliance rows stay un-digested forever (= always
displayed in the inbox; cleared via read_at on click).

Usage:
    .venv/bin/python scripts/vocab_digest.py
    .venv/bin/python scripts/vocab_digest.py --dry-run
    .venv/bin/python scripts/vocab_digest.py --since 2026-04-25
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv

HERE = Path(__file__).resolve().parent
WHRB_PROSPECTS = HERE.parent

load_dotenv(WHRB_PROSPECTS / ".env")


def _client():
    """Supabase service-role client. Bypasses RLS; intended for cron use."""
    from supabase import create_client

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print(
            "ERROR: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required.",
            file=sys.stderr,
        )
        sys.exit(2)
    return create_client(url, key)


def fetch_admins(sb) -> dict[str, str]:
    """Map admin user_id → vocab_notify_mode."""
    res = (
        sb.table("profiles")
        .select("id,vocab_notify_mode,role")
        .eq("role", "admin")
        .execute()
    )
    return {row["id"]: row.get("vocab_notify_mode", "digest_daily") for row in (res.data or [])}


def fetch_pending(sb, admin_ids: list[str]) -> list[dict]:
    """Pending rows for the given admins. Excludes compliance-axis rows."""
    if not admin_ids:
        return []
    res = (
        sb.table("notifications")
        .select("id,recipient_id,payload,created_at")
        .eq("kind", "tag_vocab_pending")
        .is_("digested_at", "null")
        .is_("read_at", "null")
        .in_("recipient_id", admin_ids)
        .execute()
    )
    rows = res.data or []
    out = []
    for row in rows:
        payload = row.get("payload") or {}
        if payload.get("axis") == "compliance":
            continue
        out.append(row)
    return out


def mark_digested(sb, ids: list[str]) -> None:
    if not ids:
        return
    sb.table("notifications").update({"digested_at": datetime.now(timezone.utc).isoformat()}).in_(
        "id", ids
    ).execute()


def log_event(sb, **kwargs) -> None:
    """Insert one event_log row. Kept narrow on purpose — no batching."""
    payload = {
        "source": "pipeline",
        "level": kwargs.get("level", "info"),
        "category": kwargs["category"],
        "message": kwargs["message"],
        "context": kwargs.get("context", {}),
    }
    sb.table("event_log").insert(payload).execute()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="Print actions without writing.")
    ap.add_argument(
        "--since",
        type=str,
        default=None,
        help="(unused; reserved for time-window filtering in a future bump).",
    )
    args = ap.parse_args()

    sb = _client()
    admins = fetch_admins(sb)
    if not admins:
        print("No admins found; nothing to digest.")
        return 0

    pending = fetch_pending(sb, list(admins.keys()))
    print(f"Fetched {len(pending)} pending non-compliance vocab notifications across {len(admins)} admins.")

    by_admin: dict[str, list[dict]] = defaultdict(list)
    for row in pending:
        by_admin[row["recipient_id"]].append(row)

    summary_total = 0
    digested_total = 0

    for admin_id, mode in admins.items():
        rows = by_admin.get(admin_id, [])
        if not rows:
            continue

        if mode == "digest_off":
            ids = [r["id"] for r in rows]
            print(f"  admin={admin_id} mode=digest_off rows={len(ids)} → mark digested only")
            if not args.dry_run:
                mark_digested(sb, ids)
            digested_total += len(ids)
            continue

        if mode == "instant":
            ids = [r["id"] for r in rows]
            print(f"  admin={admin_id} mode=instant rows={len(ids)} → mark digested (TODO email at Stage 11)")
            if not args.dry_run:
                mark_digested(sb, ids)
            digested_total += len(ids)
            continue

        # digest_daily (default)
        # Aggregate by (axis, value) — same vocab value can appear on
        # multiple notifications if dedup didn't catch a race.
        unique_vocab: dict[tuple[str, str], int] = defaultdict(int)
        for r in rows:
            payload = r.get("payload") or {}
            axis = payload.get("axis", "?")
            value = payload.get("value", "?")
            unique_vocab[(axis, value)] += 1
        ids = [r["id"] for r in rows]
        summary = [
            {"axis": a, "value": v, "occurrences": n}
            for (a, v), n in unique_vocab.items()
        ]
        print(
            f"  admin={admin_id} mode=digest_daily rows={len(ids)} unique_vocab={len(unique_vocab)} → mark digested + log summary"
        )
        if not args.dry_run:
            mark_digested(sb, ids)
            log_event(
                sb,
                level="info",
                category="vocab_digest_summary",
                message=f"daily digest delivered to admin {admin_id}: {len(unique_vocab)} unique pending values",
                context={
                    "admin_id": admin_id,
                    "total_notifications": len(ids),
                    "unique_vocab_count": len(unique_vocab),
                    "summary": summary,
                },
            )
            summary_total += 1
        digested_total += len(ids)

    print(
        f"\nDone. digested={digested_total} digest_summaries={summary_total} dry_run={args.dry_run}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
