#!/usr/bin/env python3
"""Sync WHRB-wide Google Calendar (or any ICS feed) into schedule_events.

Reads `schedule_external_calendars` for `enabled=true` rows, fetches each
ICS feed, and upserts events into `schedule_events` keyed by
`(external_source='google_calendar', external_calendar_id, external_id)`.
The unique partial index makes the upsert idempotent and per-feed scoped
so feed A cannot clobber feed B's events by reusing a UID.

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
import ipaddress
import json
import os
import re
import socket
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path
from urllib.parse import urlparse, urlsplit, urlunsplit
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
MAX_FEED_BYTES = 10 * 1024 * 1024  # 10 MB cap on ICS body
MAX_REDIRECTS = 3
HTTP_TIMEOUT = 30
USER_AGENT = "WHRB-prospects-sync/1.0 (+https://sales.whrb.org)"

# Advisory-lock namespace key — pg_try_advisory_xact_lock(hashtext(...))
# scoped per feed so two concurrent runs of this worker can't race on the
# same row. The job-level concurrency: external-calendar-sync GHA group
# is the primary defense; this is belt-and-suspenders.
LOCK_PREFIX = "schedule_sync_feed:"

_URL_RE = re.compile(r"https?://[^\s<>\"']+")
_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.I,
)


class FetchError(RuntimeError):
    """Raised by `_safe_fetch` when the feed can't be fetched safely.

    Carries a category (one of: `scheme`, `host_resolve`, `private_ip`,
    `redirect_loop`, `body_too_large`, `timeout`, `http_status`, `tls`,
    `connect`) and a status code where applicable. Only the category and
    a host-only detail string are persisted to `last_error` and
    `event_log` so secrets in feed URLs (e.g. Google's "Secret address
    in iCal format" tokens) do not leak into the DB or admin UI.
    """

    def __init__(self, category: str, status: int | None = None, detail: str = ""):
        super().__init__(f"{category} (status={status})" if status else category)
        self.category = category
        self.status = status
        self.detail = detail


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
    except Exception as exc:
        # Log only the exception class — never the DSN, which carries the password.
        print(
            f"Pooler connect failed ({exc.__class__.__name__}); falling back to direct.",
            file=sys.stderr,
        )
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


def _strip_url_for_log(url: str) -> str:
    """Return a host-only string safe to log; never the path/query/secret."""
    try:
        parsed = urlsplit(url)
        return f"{parsed.scheme}://{parsed.hostname}" if parsed.hostname else "(invalid url)"
    except Exception:
        return "(invalid url)"


def _resolve_and_validate_host(host: str) -> None:
    """Resolve `host` and raise FetchError if any A/AAAA result is private.

    Defense against SSRF via DNS rebinding or HTTP redirects to internal
    services. We resolve once here; the actual `requests.get` will resolve
    again, so a TOCTOU window exists — but combined with `allow_redirects=False`
    and a host allow-list discipline at the admin layer, this raises the bar
    significantly without requiring socket-level monkey-patching.
    """
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror as exc:
        raise FetchError("host_resolve", detail=exc.__class__.__name__) from exc
    for info in infos:
        sockaddr = info[4]
        ip_str = sockaddr[0]
        try:
            ip = ipaddress.ip_address(ip_str)
        except ValueError:
            continue
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_reserved
            or ip.is_multicast
            or ip.is_unspecified
        ):
            raise FetchError("private_ip", detail=f"{host} -> {ip_str}")


def _safe_fetch(url: str) -> str:
    """Fetch an ICS feed with strict SSRF + size protections.

    - HTTPS only.
    - DNS-resolved IP must be globally routable (rejects RFC1918, loopback,
      link-local, multicast, reserved, IPv6 ULA, etc.).
    - Redirects walked manually, max 3 hops, every hop re-validated.
    - `verify=True` (explicit, not relying on requests defaults).
    - Streamed read with a hard byte cap (`MAX_FEED_BYTES`).
    - No retry on 5xx — the cron will pick up next interval.
    """
    current = url
    for _ in range(MAX_REDIRECTS + 1):
        parsed = urlparse(current)
        if parsed.scheme != "https":
            raise FetchError("scheme", detail=parsed.scheme or "(empty)")
        if not parsed.hostname:
            raise FetchError("scheme", detail="(no host)")
        _resolve_and_validate_host(parsed.hostname)
        try:
            res = requests.get(
                current,
                timeout=HTTP_TIMEOUT,
                allow_redirects=False,
                stream=True,
                verify=True,
                headers={
                    "User-Agent": USER_AGENT,
                    "Accept": "text/calendar, text/plain;q=0.5",
                },
            )
        except requests.exceptions.SSLError as exc:
            raise FetchError("tls", detail=exc.__class__.__name__) from exc
        except requests.exceptions.Timeout as exc:
            raise FetchError("timeout", detail=exc.__class__.__name__) from exc
        except requests.exceptions.ConnectionError as exc:
            raise FetchError("connect", detail=exc.__class__.__name__) from exc

        if res.status_code in (301, 302, 303, 307, 308):
            location = res.headers.get("Location", "")
            res.close()
            if not location:
                raise FetchError("http_status", status=res.status_code)
            if location.startswith("/"):
                base = urlsplit(current)
                location = urlunsplit((base.scheme, base.netloc, location, "", ""))
            current = location
            continue

        if res.status_code >= 400:
            res.close()
            raise FetchError("http_status", status=res.status_code)

        chunks: list[bytes] = []
        total = 0
        try:
            for chunk in res.iter_content(chunk_size=64 * 1024):
                if not chunk:
                    continue
                total += len(chunk)
                if total > MAX_FEED_BYTES:
                    res.close()
                    raise FetchError(
                        "body_too_large",
                        status=res.status_code,
                        detail=str(MAX_FEED_BYTES),
                    )
                chunks.append(chunk)
        finally:
            res.close()

        body = b"".join(chunks)
        encoding = res.encoding or "utf-8"
        try:
            return body.decode(encoding, errors="replace")
        except LookupError:
            return body.decode("utf-8", errors="replace")

    raise FetchError("redirect_loop", detail=f"max={MAX_REDIRECTS}")


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
    match = _URL_RE.search(description)
    if not match:
        return None
    return match.group(0).rstrip(".,);]}>")


def _expand_events(cal: icalendar.Calendar, horizon_start: datetime, horizon_end: datetime):
    """Yield (uid, master_uid, dtstart, dtend, summary, description, location).

    Per-rule cap (`MAX_OCCURRENCES_PER_RULE`) protects against pathological
    RRULEs (e.g. `FREQ=SECONDLY;COUNT=999999999`) blowing up memory and CPU.
    Single bad VEVENTs are skipped rather than killing the whole feed.
    """
    expanded = recurring_ical_events.of(cal).between(horizon_start, horizon_end)
    per_master: dict[str, int] = {}
    for vevent in expanded:
        try:
            uid = str(vevent.get("UID") or "")
        except Exception:
            continue
        if not uid:
            continue
        master_uid = uid.split("_", 1)[0] if "_" in uid else uid
        if per_master.get(master_uid, 0) >= MAX_OCCURRENCES_PER_RULE:
            continue
        try:
            dtstart_raw = vevent.get("DTSTART")
            dtstart = _to_utc(dtstart_raw.dt) if dtstart_raw is not None else None
            dtend_raw = vevent.get("DTEND")
            dtend = _to_utc(dtend_raw.dt) if dtend_raw is not None else None
        except Exception:
            continue
        if not dtstart:
            continue
        per_master[master_uid] = per_master.get(master_uid, 0) + 1
        yield (
            uid,
            master_uid,
            dtstart,
            dtend,
            str(vevent.get("SUMMARY") or "(untitled event)"),
            str(vevent.get("DESCRIPTION") or "") or None,
            str(vevent.get("LOCATION") or "") or None,
        )


def _persist_failure(
    conn,
    cal_id: str,
    *,
    error_category: str,
    status: int | None,
    host: str,
) -> None:
    """Write `last_status='failure'` and an event_log row in a fresh transaction.

    Stores the error CATEGORY plus host-only metadata — never the raw URL,
    response body, or exception text (which can leak feed-URL secret tokens
    or DSN-bearing exception strings).
    """
    detail = error_category if status is None else f"{error_category} status={status}"
    detail = detail[:200]
    with conn.cursor() as cur:
        cur.execute(
            """
            update public.schedule_external_calendars
               set last_status='failure',
                   last_error=%s,
                   last_synced_at=now()
             where id=%s
            """,
            (detail, cal_id),
        )
        _emit_event(
            cur,
            level="error",
            category="external_calendar_sync_failed",
            message="ICS sync failed",
            context={
                "calendar_id": cal_id,
                "error_category": error_category,
                "status": status,
                "host": host,
            },
        )
    conn.commit()


def _sync_feed(conn, row: dict, dry_run: bool = False) -> dict:
    """Sync a single feed.

    All work for one feed runs inside a transaction guarded by an
    advisory lock so two concurrent worker processes can't race on the
    same row. On any error the transaction is rolled back and a
    failure status is committed in a fresh transaction, so the calendar
    never gets stuck in `last_status='running'`.
    """
    cal_id = row["id"]
    feed_url = row["feed_url"]
    safe_url = _strip_url_for_log(feed_url)
    summary = {
        "calendar_id": cal_id,
        "added": 0,
        "updated": 0,
        "tombstoned": 0,
        "errors": 0,
    }

    with conn.cursor() as cur:
        cur.execute(
            "select pg_try_advisory_xact_lock(hashtext(%s))",
            (LOCK_PREFIX + str(cal_id),),
        )
        got_lock = cur.fetchone()[0]
    if not got_lock:
        return {**summary, "skipped": "lock_busy"}

    with conn.cursor() as cur:
        cur.execute(
            "update public.schedule_external_calendars set last_status='running' where id=%s",
            (cal_id,),
        )

    try:
        text = _safe_fetch(feed_url)
    except FetchError as exc:
        conn.rollback()
        _persist_failure(
            conn,
            cal_id,
            error_category=f"fetch:{exc.category}",
            status=exc.status,
            host=safe_url,
        )
        summary["errors"] += 1
        return summary

    if len(text) > MAX_FEED_BYTES:
        conn.rollback()
        _persist_failure(
            conn,
            cal_id,
            error_category="parse:too_large",
            status=None,
            host=safe_url,
        )
        summary["errors"] += 1
        return summary
    try:
        cal = icalendar.Calendar.from_ical(text)
    except Exception as exc:
        conn.rollback()
        _persist_failure(
            conn,
            cal_id,
            error_category=f"parse:{exc.__class__.__name__}",
            status=None,
            host=safe_url,
        )
        summary["errors"] += 1
        return summary

    horizon_start = datetime.now(UTC) - timedelta(days=HORIZON_PAST_DAYS)
    horizon_end = datetime.now(UTC) + timedelta(days=HORIZON_FUTURE_DAYS)

    seen_external_ids: set[str] = set()
    upserts = 0
    truncated = False

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
                truncated = True
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
                on conflict (external_source, external_calendar_id, external_id)
                  where external_source is not null
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
                returning (xmax = 0) as inserted
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
            inserted = cur.fetchone()[0]
            if inserted:
                summary["added"] += 1
            else:
                summary["updated"] += 1
            upserts += 1

        # Tombstone rows that disappeared from the feed but still have a future
        # starts_at — surface "Cancelled in source" rather than deleting. SKIP
        # entirely when:
        #   * we hit MAX_UPSERTS_PER_RUN (the seen set is incomplete, so we'd
        #     wrongly tombstone everything past that cap and thrash on each run);
        #   * the feed legitimately returned zero events (an empty seen set
        #     would tombstone every future event in the calendar — almost
        #     certainly an upstream incident, not a legitimate clear).
        if seen_external_ids and not truncated:
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

    if args.calendar_id and not _UUID_RE.match(args.calendar_id):
        print("ERROR: --calendar-id must be a UUID", file=sys.stderr)
        return 2

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
            try:
                summary = _sync_feed(conn, feed, dry_run=args.dry_run)
                conn.commit()
            except Exception as exc:
                # A bug in this worker must not poison subsequent feeds.
                conn.rollback()
                _persist_failure(
                    conn,
                    feed["id"],
                    error_category=f"worker:{exc.__class__.__name__}",
                    status=None,
                    host=_strip_url_for_log(feed["feed_url"]),
                )
                print(
                    f"ERROR syncing {feed['id']}: {exc.__class__.__name__}",
                    file=sys.stderr,
                )
                continue
            print(json.dumps(summary, indent=2, default=str))

        if not feeds:
            print("No enabled calendars; nothing to do.")
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
