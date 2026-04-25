#!/usr/bin/env python3
"""Replay cache/last_tag_sync_emit.json after a tag_sync failure (plan §4.5).

The pipeline's ``08_b_tag_sync`` phase caches the emit set on exception so
an admin-triggered replay doesn't need to rerun scraping. This script
reloads that cache and calls ``db.supabase_sync.tag_sync`` directly.

Idempotent: the underlying ``prospect_tags`` INSERT uses
``on_conflict (prospect_id, tag_id) do nothing``, so replaying a successful
run is a no-op.

Usage:
    .venv/bin/python scripts/retry_tag_sync.py
    .venv/bin/python scripts/retry_tag_sync.py --cache cache/custom.json
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
WHRB = HERE.parent
sys.path.insert(0, str(WHRB))

DEFAULT_CACHE = WHRB / "cache" / "last_tag_sync_emit.json"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--cache",
        type=Path,
        default=DEFAULT_CACHE,
        help="Path to the emit cache JSON. Default: cache/last_tag_sync_emit.json",
    )
    args = ap.parse_args()

    if not args.cache.exists():
        print(f"No emit cache at {args.cache}; nothing to retry.", file=sys.stderr)
        return 1
    try:
        payload = json.loads(args.cache.read_text())
    except Exception as e:
        print(f"Cache parse failed: {type(e).__name__}: {e}", file=sys.stderr)
        return 2
    if not isinstance(payload, list):
        print(f"Cache payload is not a list (got {type(payload).__name__})", file=sys.stderr)
        return 2

    # Load env + supabase_sync only once the cache is validated.
    from dotenv import load_dotenv

    load_dotenv(WHRB / ".env")
    from db import supabase_sync

    summary = supabase_sync.tag_sync(payload)
    print(f"[retry_tag_sync] {summary}")

    # Success path: remove the cache file so the admin UI stops nagging.
    if summary.get("failed", 0) == 0:
        try:
            args.cache.unlink()
            print(f"[retry_tag_sync] cleared {args.cache}")
        except Exception as e:
            print(f"[retry_tag_sync] cache unlink suppressed: {e}")
        return 0
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
