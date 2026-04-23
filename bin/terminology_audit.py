#!/usr/bin/env python3
"""Terminology audit — grep `(?i)underwri` across the repo and check every
hit against TERMINOLOGY.md's allowlist.

Per gleaming-dawn §1.3 #14 and §3.4: the buyer-noun for WHRB ad sales is
**advertiser** or **sponsor**. "Underwriter" as a buyer noun is banned.
"Underwriting" as a process / FCC frame noun is allowed in specific
contexts catalogued in TERMINOLOGY.md.

Exit codes:
  0  no hits, or every hit is allowlisted in TERMINOLOGY.md
  1  uncatalogued `underwri*` hit found, or any standalone "underwriter" /
     "underwriters" buyer-noun usage anywhere

Usage:
    python bin/terminology_audit.py
    python bin/terminology_audit.py --strict      (also fail on TODO comments)
    python bin/terminology_audit.py --json        (machine-readable output)
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

# Files / directories to skip — generated artifacts, third-party code,
# off-repo plan files, this script + its companion docs.
SKIP_DIRS = {
    "node_modules",
    ".next",
    ".vercel",
    "dist",
    "build",
    "playwright-report",
    "test-results",
    "__pycache__",
    ".venv",
    ".git",
}
# Files that themselves *describe* the terminology rules — they will of
# course mention "underwriting" without being violations.
SKIP_FILES = {
    "TERMINOLOGY.md",
    "bin/terminology_audit.py",
}


def _git_files() -> list[Path]:
    """All tracked + untracked files known to git, minus skip dirs."""
    try:
        out = subprocess.check_output(
            ["git", "-C", str(REPO_ROOT), "ls-files",
             "--cached", "--others", "--exclude-standard"],
            text=True,
        )
    except subprocess.CalledProcessError:
        return []
    files: list[Path] = []
    for line in out.splitlines():
        rel = line.strip()
        if not rel:
            continue
        if any(seg in SKIP_DIRS for seg in rel.split("/")):
            continue
        if rel in SKIP_FILES:
            continue
        p = REPO_ROOT / rel
        if p.is_file():
            files.append(p)
    return files


_HIT_RE = re.compile(r"(?i)underwri")
_BUYER_RE = re.compile(r"(?i)\bunderwriter(s)?\b")


def _read_allowlist() -> set[tuple[str, int]]:
    """Parse TERMINOLOGY.md for catalogued hits.

    The allowlist sections use markdown table rows like:
        | `whrb-prospects/CLAUDE.md` | 12 | "..." | rationale |

    Returns a set of (repo-relative-path, line) tuples.
    """
    path = REPO_ROOT / "TERMINOLOGY.md"
    if not path.exists():
        return set()
    rows: set[tuple[str, int]] = set()
    row_re = re.compile(
        r"^\|\s*`([^`]+)`\s*\|\s*(\d+)\s*\|", re.MULTILINE
    )
    for m in row_re.finditer(path.read_text()):
        rows.add((m.group(1), int(m.group(2))))
    return rows


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--strict", action="store_true",
                    help="Also flag TODO/FIXME comments mentioning underwriting.")
    ap.add_argument("--json", action="store_true",
                    help="Emit JSON (machine-readable).")
    args = ap.parse_args()

    allowlist = _read_allowlist()
    files = _git_files()

    hits: list[dict] = []
    buyer_violations: list[dict] = []

    for path in files:
        try:
            text = path.read_text()
        except (UnicodeDecodeError, OSError):
            continue
        rel = str(path.relative_to(REPO_ROOT))
        for i, line in enumerate(text.splitlines(), start=1):
            if _HIT_RE.search(line):
                hits.append({
                    "file": rel, "line": i, "text": line.rstrip(),
                    "allowlisted": (rel, i) in allowlist,
                })
            if _BUYER_RE.search(line):
                buyer_violations.append({
                    "file": rel, "line": i, "text": line.rstrip(),
                })

    uncatalogued = [h for h in hits if not h["allowlisted"]]

    if args.json:
        print(json.dumps({
            "total_hits": len(hits),
            "allowlisted": sum(1 for h in hits if h["allowlisted"]),
            "uncatalogued": uncatalogued,
            "buyer_violations": buyer_violations,
        }, indent=2))
    else:
        print(f"Scanned {len(files)} files. Found {len(hits)} `underwri*` hits.")
        print(f"  Allowlisted: {sum(1 for h in hits if h['allowlisted'])}")
        print(f"  Uncatalogued: {len(uncatalogued)}")
        print(f"  Buyer-noun violations (always disallowed): {len(buyer_violations)}")
        for h in uncatalogued:
            print(f"  UNCATALOGUED  {h['file']}:{h['line']}  {h['text'][:80]}")
        for v in buyer_violations:
            print(f"  BUYER-NOUN    {v['file']}:{v['line']}  {v['text'][:80]}")

    if buyer_violations or uncatalogued:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
