#!/usr/bin/env python3
"""emitted-vocab — diff the tag values *emitted* by the pipeline against
the canonical `tag_vocabulary` rows in dev Supabase.

In T1 the pipeline does not yet emit tags (T2 wires up the emitters), so
this script reports `0 emitted, 73 canonical, 0 missing` against a clean
database. It exists from T1 onward so T2 / T6 / T7 / T8 PRs can wire it
into CI as a gate on every PR that touches `whrb-prospects/sources/`.

Approach:
1. Walk `whrb-prospects/sources/*.py`, parse the AST, look for emitter
   functions (any function whose body assigns to a dict key named `tags`
   or returns a dict with a `tags` key). For each, collect literal
   `axis:value` pairs.
2. Read `tag_vocabulary` from dev Supabase via the same .env credentials
   the rest of the scripts use.
3. Compute the set difference — values emitted but not in the vocab.

Exit codes:
  0  every emitted tag is present in tag_vocabulary
  1  one or more emitted tags missing (or any other error)

Usage:
    python bin/emitted-vocab.py
    python bin/emitted-vocab.py --json
"""
from __future__ import annotations

import argparse
import ast
import json
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SOURCES_DIR = REPO_ROOT / "whrb-prospects" / "sources"


CANONICAL_AXES = {
    "sector", "operating_model", "genre", "affiliation", "cadence",
    "daypart_fit", "history", "compliance", "other",
}


def _walk_emitted_pairs(path: Path) -> list[tuple[str, str]]:
    """Best-effort static scan for `axis:value` literals.

    Only flags strings whose `axis` prefix matches one of the 9 canonical
    axes (filters out OSM-style field tokens like `addr:city`,
    `contact:email`).
    """
    try:
        tree = ast.parse(path.read_text())
    except (SyntaxError, UnicodeDecodeError):
        return []
    pairs: list[tuple[str, str]] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            s = node.value
            if ":" in s and len(s) < 80:
                head, _, tail = s.partition(":")
                if head in CANONICAL_AXES and tail \
                   and tail.replace("_", "").isalnum():
                    pairs.append((head, tail))
    return pairs


def _read_canonical() -> set[tuple[str, str]]:
    """Read tag_vocabulary from dev Supabase via psycopg2."""
    try:
        import psycopg2  # type: ignore
        from dotenv import load_dotenv  # type: ignore
    except ImportError:
        print(
            "psycopg2 / python-dotenv not installed. "
            "Run inside whrb-prospects/.venv.",
            file=sys.stderr,
        )
        return set()
    load_dotenv(REPO_ROOT / "whrb-prospects" / ".env")
    project_ref = os.environ.get("SUPABASE_PROJECT_REF")
    password = os.environ.get("SUPABASE_DB_PASSWORD")
    if not (project_ref and password):
        print("SUPABASE_PROJECT_REF / SUPABASE_DB_PASSWORD missing.", file=sys.stderr)
        return set()
    dsn = (
        f"postgresql://postgres:{password}"
        f"@db.{project_ref}.supabase.co:5432/postgres?sslmode=require"
    )
    canonical: set[tuple[str, str]] = set()
    with psycopg2.connect(dsn, connect_timeout=10) as conn, conn.cursor() as cur:
        cur.execute(
            "select axis, value from public.tag_vocabulary "
            "where status in ('active', 'pending_admin_review')"
        )
        for axis, value in cur.fetchall():
            canonical.add((axis, value))
    return canonical


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    if not SOURCES_DIR.exists():
        print(f"sources dir not found: {SOURCES_DIR}", file=sys.stderr)
        return 1

    emitted: set[tuple[str, str]] = set()
    per_source: dict[str, list[tuple[str, str]]] = {}
    for src in sorted(SOURCES_DIR.glob("*.py")):
        if src.name == "__init__.py":
            continue
        pairs = _walk_emitted_pairs(src)
        per_source[src.name] = pairs
        emitted.update(pairs)

    canonical = _read_canonical()
    missing = sorted(emitted - canonical)
    extras = sorted(canonical - emitted)  # in vocab but not emitted (informational)

    if args.json:
        print(json.dumps({
            "emitted_count": len(emitted),
            "canonical_count": len(canonical),
            "missing": [{"axis": a, "value": v} for a, v in missing],
            "per_source": {
                k: [{"axis": a, "value": v} for a, v in vs]
                for k, vs in per_source.items()
            },
        }, indent=2))
    else:
        print(f"Emitted: {len(emitted)}  Canonical: {len(canonical)}")
        print(f"Missing from vocab (will fail strict-mode pipeline): {len(missing)}")
        for a, v in missing:
            print(f"  MISSING  {a}:{v}")
        if not missing:
            print("  (none)")

    return 1 if missing else 0


if __name__ == "__main__":
    raise SystemExit(main())
