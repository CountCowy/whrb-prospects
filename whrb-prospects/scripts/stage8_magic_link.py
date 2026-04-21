#!/usr/bin/env python3
"""Stage 8 magic-link helper — print sign-in URLs for the chrome-devtools MCP plant.

Generates a fresh access_token + refresh_token pair for each requested email
via Supabase admin generateLink → anon verifyOtp (mirrors
whrb-web/e2e/stage7/stage7.setup.ts::landMagiclink). Prints one URL per email
that the chrome-devtools MCP browser can navigate to in order to land an
authenticated session at the configured base URL.

Usage:
  .venv/bin/python scripts/stage8_magic_link.py [--base-url http://localhost:3000]
                                                [--email a@example.com] [--email b@..]

If no --email flags are passed, prints URLs for all three Stage 8 actors
(admin, rep_a, rep_b) read from cache/stage8_snapshot.json.

The hashed_token returned by generateLink is single-use and short-lived; this
script can be re-run any time to mint fresh URLs (e.g. between rep sessions).
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

HERE = Path(__file__).resolve().parent
WHRB = HERE.parent
sys.path.insert(0, str(WHRB))
load_dotenv(WHRB / ".env")

SUPABASE_URL = os.environ["SUPABASE_URL"]
ANON_KEY = os.environ["SUPABASE_ANON_KEY"]
SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

SNAPSHOT_PATH = WHRB / "cache" / "stage8_snapshot.json"


def _mint_url(email: str, base_url: str) -> str:
    admin = create_client(SUPABASE_URL, SERVICE_KEY)
    anon = create_client(SUPABASE_URL, ANON_KEY)
    link = admin.auth.admin.generate_link({"type": "magiclink", "email": email})
    # supabase-py response wrapping varies; access via attribute or dict.
    props = getattr(link, "properties", None)
    if props is None and isinstance(link, dict):
        props = link.get("properties")
    token_hash = None
    if props is not None:
        token_hash = (
            getattr(props, "hashed_token", None)
            if not isinstance(props, dict)
            else props.get("hashed_token")
        )
    if not token_hash:
        # Fallback: walk the .__dict__ so we never crash on a wrapped object.
        try:
            token_hash = link.__dict__["properties"].__dict__["hashed_token"]
        except Exception as exc:
            raise RuntimeError(
                f"Could not extract hashed_token from generate_link response: {exc!r} "
                f"(payload type={type(link).__name__})"
            )
    verified = anon.auth.verify_otp({"token_hash": token_hash, "type": "magiclink"})
    session = getattr(verified, "session", None)
    if session is None and isinstance(verified, dict):
        session = verified.get("session")
    access = getattr(session, "access_token", None)
    refresh = getattr(session, "refresh_token", None)
    if not access or not refresh:
        raise RuntimeError(f"verifyOtp returned no tokens for {email}")
    return (
        f"{base_url.rstrip('/')}/login"
        f"#access_token={access}&refresh_token={refresh}&type=magiclink"
    )


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-url", default="http://localhost:3000")
    ap.add_argument("--email", action="append", default=[])
    args = ap.parse_args()

    if not args.email:
        if not SNAPSHOT_PATH.exists():
            raise SystemExit(
                f"No --email and no {SNAPSHOT_PATH}. Run stage8_plant.py first or "
                "supply --email a@x --email b@x."
            )
        snap = json.loads(SNAPSHOT_PATH.read_text())
        emails = [snap["admin_email"], snap["rep_a_email"], snap["rep_b_email"]]
    else:
        emails = args.email

    for email in emails:
        url = _mint_url(email, args.base_url)
        print(f"{email}\t{url}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
