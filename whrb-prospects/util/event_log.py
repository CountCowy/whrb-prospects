"""Batched logger that writes to Supabase ``public.event_log``.

Emission is fire-and-forget: every helper catches and swallows its own
exceptions so log writes can never take down the scraper or sync pipeline.
Events buffer in-process and flush every ``FLUSH_EVERY`` events or at
process exit via ``atexit``.

A module-level ``pipeline_run_id`` is stamped onto every event. ``pipeline.py``
calls :func:`set_pipeline_run_id` after inserting the ``pipeline_runs`` row
at startup; CLI and web-triggered runs both flow through this path.

Round-7 clarification: required for every pipeline run, not just web ones.
"""
from __future__ import annotations

import atexit
import json
import os
import sys
import threading
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

_WHRB_PROSPECTS = Path(__file__).resolve().parent.parent
load_dotenv(_WHRB_PROSPECTS / ".env")

FLUSH_EVERY = 50
_LOCK = threading.Lock()
_BUFFER: list[dict[str, Any]] = []
_PIPELINE_RUN_ID: str | None = None
_CLIENT = None
_INITIALIZED = False


def _client():
    """Return a lazily-initialized service-role Supabase client.

    Returns ``None`` if credentials are missing (dev envs with no DB). All
    callers treat ``None`` as a no-op.
    """
    global _CLIENT, _INITIALIZED
    if _INITIALIZED:
        return _CLIENT
    _INITIALIZED = True
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        return None
    try:
        from supabase import create_client

        _CLIENT = create_client(url, key)
    except Exception as e:  # noqa: BLE001
        print(f"[event_log] client init failed: {type(e).__name__}: {e}", file=sys.stderr)
        _CLIENT = None
    return _CLIENT


def set_pipeline_run_id(run_id: str | None) -> None:
    """Stamp every subsequent event with ``pipeline_run_id``."""
    global _PIPELINE_RUN_ID
    _PIPELINE_RUN_ID = run_id


def get_pipeline_run_id() -> str | None:
    return _PIPELINE_RUN_ID


def log(
    level: str,
    category: str,
    message: str,
    *,
    context: dict | None = None,
    url: str | None = None,
    http_status: int | None = None,
) -> None:
    """Enqueue one event. Never raises."""
    try:
        ctx = dict(context) if context else {}
        # keep context JSON-serializable
        try:
            json.dumps(ctx)
        except TypeError:
            ctx = {k: repr(v) for k, v in ctx.items()}
        row = {
            "source": "pipeline",
            "level": level,
            "category": category,
            "message": message[:4000] if message else "",
            "context": ctx,
            "pipeline_run_id": _PIPELINE_RUN_ID,
        }
        if url is not None:
            row["url"] = url
        if http_status is not None:
            row["http_status"] = http_status
        with _LOCK:
            _BUFFER.append(row)
            should_flush = len(_BUFFER) >= FLUSH_EVERY
        if should_flush:
            flush()
    except Exception as e:  # noqa: BLE001
        print(f"[event_log] log() suppressed: {type(e).__name__}: {e}", file=sys.stderr)


def info(category: str, message: str, **kwargs) -> None:
    log("info", category, message, **kwargs)


def warn(category: str, message: str, **kwargs) -> None:
    log("warn", category, message, **kwargs)


def error(category: str, message: str, **kwargs) -> None:
    log("error", category, message, **kwargs)


def fatal(category: str, message: str, **kwargs) -> None:
    log("fatal", category, message, **kwargs)


def flush() -> None:
    """Drain the buffer to Supabase. Never raises."""
    with _LOCK:
        if not _BUFFER:
            return
        batch = list(_BUFFER)
        _BUFFER.clear()
    client = _client()
    if client is None:
        return
    try:
        client.table("event_log").insert(batch).execute()
    except Exception as e:  # noqa: BLE001
        # Don't recurse back into event_log; stderr is the last line of defense.
        print(f"[event_log] flush suppressed: {type(e).__name__}: {e}", file=sys.stderr)


@atexit.register
def _flush_on_exit() -> None:
    try:
        flush()
    except Exception:  # noqa: BLE001
        pass
