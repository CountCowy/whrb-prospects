#!/usr/bin/env python3
"""Sync WHRB-wide Google Calendar (or any ICS feed) into schedule_events.

Reads `schedule_external_calendars` for `enabled=true` rows, fetches each
ICS feed, and upserts events into `schedule_events` keyed by
`(external_source='google_calendar', external_id=<ICS UID>)`. The unique
partial index makes the upsert idempotent.

Recurring ICS events are expanded into independent rows that share a
deterministic `series_id = uuid5(NAMESPACE_URL, feed_id + master_uid)`,
matching the per-occurrence model used by user-created series.

Tombstones: rows whose `external_id` no longer appears in the feed get
their `metadata.cancelled_in_source = true` flag set rather than being
deleted, so reps' reminders aren't quietly removed.

Usage:
    .venv/bin/python scripts/sync_external_calendars.py
    .venv/bin/python scripts/sync_external_calendars.py --calendar-id <uuid>
    .venv/bin/python scripts/sync_external_calendars.py --dry-run
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import UUID, uuid5

import psycopg2
import psycopg2.extras
import requests
from dotenv import load_dotenv

try:
    import icalendar  # type: ignore
    import recurring_ical_events  # type: ignore
except ImportError as exc:  # pragma: no cover
    print(
        "ERROR: install icalendar + recurring-ical-events in requirements.txt",
        file=sys.stderr,
    )
    raise SystemExit(2) from exc

HERE = Path(__file__).resolve().parent
WHRB_PROSPECTS = HERE.parent
NAMESPACE_URL = UUID("6ba7b811-9dad-11d1-80b4-00c04fd430c8")
HORIZON_FUTURE_DAYS = 365  # how far ahead to expand RRULEs
HORIZON_PAST_DAYS = 180  # don't backfill events older than this
MAX_OCCURRENCES_PER_RULE = 200
MAX_UPSERTS_PER_RUN = 500
HTTP_TIMEOUT = 30


def _conn():
    load_dotenv(WHRB_PROSPECTS / ".env")
    project_ref = os.environ.get("SUPABASE_PROJECT_REF")
    password = os.environ.get("SUPABASE_DB_PASSWORD")
    if not project_ref or not password:
        print(
            "ERROR: SUPABASE_PROJECT_REF and SUPABASE_DB_PASSWORD must be set",
            file=sys.stderr,
        )
        sys.exit(2)
    pooler = (
        f"postgresql://postgres.{project_ref}:{password}"
        "@aws-1-us-west-2.pooler.supabase.com:5432/postgres?sslmode=require"
    )
    direct = (
        f"postgresql://postgres:{password}"
        f"@db.{project_ref}.supabase.co:5432/postgres?sslmode=require"
    )
    try:
        return psycopg2.connect(pooler, connect_timeout=10)
    except Exception:
        return psycopg2.connect(direct, connect_timeout=10)


def _emit_event(
    cur,
    *,
    level: str,
    category: str,
    message: str,
    context: dict,
):
    cur.execute(
        """
        insert into public.event_log (source, level, category, message, context)
        values ('pipeline', %s, %s, %s, %s::jsonb)
        """,
        (level, category, message, json.dumps(context)),
    )


def _fetch_feed(url: str) -> str:
    res = requests.get(url, timeout=HTTP_TIMEOUT)
    if res.status_code >= 500:
        # one retry on 5xx
        res = requests.get(url, timeout=HTTP_TIMEOUT)
    res.raise_for_status()
    return res.text


def _to_utc(value) -> datetime | None:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=UTC)
        return value.astimezone(UTC)
    return None


def _series_id(calendar_id: str, master_uid: str) -> str:
    return str(uuid5(NAMESPACE_URL, f"{calendar_id}::{master_uid}"))


def _extract_url(description: str | None) -> str | None:
    if not description:
        return None
    import re

    match = re.search(r"https?://\S+", description)
    return match.group(0) if match else None


def _expand_events(cal: icalendar.Calendar, horizon_start: datetime, horizon_end: datetime):
    """Yield (uid, master_uid, dtstart, dtend, summary, description, location)."""
    expanded = recurring_ical_events.of(cal).between(horizon_start, horizon_end)
    for vevent in expanded:
        uid = str(vevent.get("UID") or "")
        if not uid:
            continue
        # `recurring_ical_events` gives each occurrence a UID with a recur-id
        # suffix; strip it to recover the master UID for series_id.
        master_uid = uid.split("_", 1)[0] if "_" in uid else uid
        dtstart = _to_utc(vevent.decoded("DTSTART", default=None)) if vevent.get("DTSTART") else None
        dtend = _to_utc(vevent.decoded("DTEND", default=None)) if vevent.get("DTEND") else None
        if not dtstart:
            continue
        yield (
            uid,
            master_uid,
            dtstart,
            dtend,
            str(vevent.get("SUMMARY") or "(untitled event)"),
            str(vevent.get("DESCRIPTION") or "") or None,
            str(vevent.get("LOCATION") or "") or None,
        )


def _sync_feed(conn, row: dict, dry_run: bool = False) -> dict:
    cal_id = row["id"]
    feed_url = row["feed_url"]
    summary = {"calendar_id": cal_id, "added": 0, "updated": 0, "tombstoned": 0, "errors": 0}

    with conn.cursor() as cur:
        cur.execute(
            "update public.schedule_external_calendars set last_status='running' where id=%s",
            (cal_id,),
        )
        try:
            text = _fetch_feed(feed_url)
        except Exception as exc:
            cur.execute(
                """
                update public.schedule_external_calendars
                   set last_status='failure',
                       last_error=%s,
                       last_synced_at=now()
                 where id=%s
                """,
                (str(exc)[:500], cal_id),
            )
            _emit_event(
                cur,
                level="error",
                category="external_calendar_sync_failed",
                message="ICS fetch failed",
                context={"calendar_id": cal_id, "error": str(exc)[:500]},
            )
            summary["errors"] += 1
            return summary

    try:
        cal = icalendar.Calendar.from_ical(text)
    except Exception as exc:
        with conn.cursor() as cur:
            cur.execute(
                """
                update public.schedule_external_calendars
                   set last_status='failure',
                       last_error=%s,
                       last_synced_at=now()
                 where id=%s
                """,
                (f"parse: {str(exc)[:500]}", cal_id),
            )
        summary["errors"] += 1
        return summary

    horizon_start = datetime.now(UTC) - timedelta(days=HORIZON_PAST_DAYS)
    horizon_end = datetime.now(UTC) + timedelta(days=HORIZON_FUTURE_DAYS)

    seen_external_ids: set[str] = set()
    upserts = 0

    with conn.cursor() as cur:
        for (
            uid,
            master_uid,
            dtstart,
            dtend,
            summary_str,
            description,
            location,
        ) in _expand_events(cal, horizon_start, horizon_end):
            if upserts >= MAX_UPSERTS_PER_RUN:
                _emit_event(
                    cur,
                    level="warn",
                    category="external_calendar_sync_truncated",
                    message="hit MAX_UPSERTS_PER_RUN; will resume next run",
                    context={"calendar_id": cal_id, "limit": MAX_UPSERTS_PER_RUN},
                )
                break
            seen_external_ids.add(uid)
            duration = 60
            if dtend and dtstart:
                delta = (dtend - dtstart).total_seconds() / 60
                duration = max(1, int(delta) if delta > 0 else 60)
            sid = _series_id(cal_id, master_uid)
            url_in_desc = _extract_url(description)
            if dry_run:
                upserts += 1
                continue
            cur.execute(
                """
                insert into public.schedule_events
                  (title, description, category, starts_at, duration_minutes,
                   all_day, assignee_kind, assigned_to, prospect_id, location,
                   url, visibility, metadata,
                   external_source, external_calendar_id, external_id,
                   external_synced_at, series_id)
                values
                  (%(title)s, %(description)s, %(category)s, %(starts_at)s, %(duration)s,
                   false, %(assignee_kind)s, null, null, %(location)s,
                   %(url)s, 'public', %(metadata)s::jsonb,
                   'google_calendar', %(calendar_id)s, %(external_id)s,
                   now(), %(series_id)s)
                on conflict (external_source, external_id) where external_source is not null
                do update set
                  title = excluded.title,
                  description = excluded.description,
                  starts_at = excluded.starts_at,
                  duration_minutes = excluded.duration_minutes,
                  location = excluded.location,
                  url = excluded.url,
                  external_synced_at = now(),
                  metadata = case
                    when public.schedule_events.metadata ? 'cancelled_in_source'
                    then public.schedule_events.metadata - 'cancelled_in_source'
                    else public.schedule_events.metadata
                  end
                returning xmax::text::int as updated
                """,
                {
                    "title": summary_str[:200],
                    "description": (description or "")[:5000] or None,
                    "category": row["default_category"],
                    "starts_at": dtstart,
                    "duration": duration,
                    "assignee_kind": row["default_assignee_kind"],
                    "location": (location or "")[:300] or None,
                    "url": (url_in_desc or "")[:1000] or None,
                    "metadata": json.dumps({}),
                    "calendar_id": cal_id,
                    "external_id": uid,
                    "series_id": sid,
                },
            )
            updated_xmax = cur.fetchone()[0]
            if updated_xmax == 0:
                summary["added"] += 1
            else:
                summary["updated"] += 1
            upserts += 1

        # Tombstone rows that disappeared from the feed but still have a future
        # starts_at — surface "Cancelled in source" rather than deleting.
        if seen_external_ids:
            cur.execute(
                """
                update public.schedule_events
                   set metadata = jsonb_set(coalesce(metadata,'{}'::jsonb),
                                            '{cancelled_in_source}', 'true', true)
                 where external_calendar_id = %s
                   and external_source = 'google_calendar'
                   and external_id <> all(%s::text[])
                   and starts_at >= now()
                   and (metadata->>'cancelled_in_source') is distinct from 'true'
                """,
                (cal_id, list(seen_external_ids)),
            )
            summary["tombstoned"] = cur.rowcount

        cur.execute(
            """
            update public.schedule_external_calendars
               set last_status='success',
                   last_error=null,
                   last_synced_at=now()
             where id=%s
            """,
            (cal_id,),
        )
        _emit_event(
            cur,
            level="info",
            category="external_calendar_sync_complete",
            message="sync run finished",
            context=summary,
        )
    return summary


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--calendar-id", help="Sync only the given feed UUID")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    conn = _conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            if args.calendar_id:
                cur.execute(
                    "select * from public.schedule_external_calendars where id=%s and enabled=true",
                    (args.calendar_id,),
                )
            else:
                cur.execute(
                    "select * from public.schedule_external_calendars where enabled=true order by created_at"
                )
            feeds = list(cur.fetchall())

        for feed in feeds:
            print(f"--- syncing {feed['name']} ({feed['id']}) ---")
            summary = _sync_feed(conn, feed, dry_run=args.dry_run)
            conn.commit()
            print(json.dumps(summary, indent=2, default=str))

        if not feeds:
            print("No enabled calendars; nothing to do.")
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
