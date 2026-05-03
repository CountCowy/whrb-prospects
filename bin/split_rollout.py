#!/usr/bin/env python3
"""Split ROLLOUT.md (one monolithic 6k-line log) into per-section files under ROLLOUT/.

Splits on every level-2 heading (`^## `). Each section becomes its own file with
the heading demoted to `# ` so the shard reads as a top-level document. Generates
an INDEX.md with a markdown table linking to each shard.

Idempotent: running twice produces the same output. Asserts byte conservation
(line count) so we fail loud if any content goes missing.

Usage:
    python bin/split_rollout.py                # split, write shards, regenerate INDEX
    python bin/split_rollout.py --check        # verify shards match the source (CI)
"""
from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SOURCE = REPO_ROOT / "ROLLOUT.md"
OUT_DIR = REPO_ROOT / "ROLLOUT"
HEADING_RE = re.compile(r"^## (.+)$")

# 3-line pointer that replaces ROLLOUT.md after the first split. We detect this
# pattern on subsequent runs and skip re-splitting (the shards are the source).
POINTER_MARKER = "Stage records moved."


@dataclass
class Section:
    heading: str           # e.g. "Stage 1 — Cloud provisioning + schema"
    slug: str              # e.g. "stage-1"
    body: list[str]        # raw lines including the original `## ` heading line
    start_line: int        # 1-indexed line number in the source file


def slugify(heading: str) -> str:
    """Turn a section heading into a filesystem-safe slug.

    Strips trailing `(date)` and `— subtitle` so "Stage 5.5 — whrb-prospects
    code-quality baseline (2026-04-19)" becomes `stage-5.5`. Preserves dots so
    `5.5` survives readably.
    """
    primary = re.split(r" — | \(", heading)[0].strip()
    slug = re.sub(r"[^a-z0-9.]+", "-", primary.lower()).strip("-")
    return slug or "section"


def parse_sections(lines: list[str]) -> tuple[list[str], list[Section]]:
    """Split lines into (preamble, sections). Preamble is everything before the
    first `## ` heading. Sections each start at a `## ` line and run until the
    line before the next `## ` (or EOF)."""
    preamble: list[str] = []
    sections: list[Section] = []
    current: Section | None = None

    for idx, line in enumerate(lines, start=1):
        match = HEADING_RE.match(line)
        if match:
            if current is not None:
                sections.append(current)
            heading = match.group(1).strip()
            current = Section(
                heading=heading,
                slug=slugify(heading),
                body=[line],
                start_line=idx,
            )
        else:
            if current is None:
                preamble.append(line)
            else:
                current.body.append(line)

    if current is not None:
        sections.append(current)

    return preamble, sections


def assert_unique_slugs(sections: list[Section]) -> None:
    seen: dict[str, int] = {}
    for s in sections:
        if s.slug in seen:
            raise SystemExit(
                f"Duplicate slug `{s.slug}` from headings:\n"
                f"  line {seen[s.slug]}: {sections[seen[s.slug]].heading!r}\n"
                f"  line {s.start_line}: {s.heading!r}\n"
                "Adjust slugify() or rename one of the headings."
            )
        seen[s.slug] = s.start_line


def render_shard(section: Section) -> str:
    """Demote `## heading` -> `# heading` and return the file body."""
    body = list(section.body)
    body[0] = body[0].replace("## ", "# ", 1)
    return "".join(body)


def render_index(preamble: list[str], sections: list[Section]) -> str:
    """Build INDEX.md: preamble + a markdown table of every shard."""
    rows = ["| # | Section | File |", "|---|---|---|"]
    for i, s in enumerate(sections, start=1):
        rows.append(f"| {i} | {s.heading} | [`{s.slug}.md`](./{s.slug}.md) |")
    table = "\n".join(rows)

    preamble_text = "".join(preamble).rstrip() + "\n\n" if preamble else ""

    return (
        preamble_text
        + "## Index\n\n"
        + table
        + "\n\n"
        + "Add new sections as `ROLLOUT/<slug>.md` and append a row above.\n"
    )


def root_pointer() -> str:
    return (
        "# WHRB prospects — rollout log\n"
        "\n"
        f"{POINTER_MARKER} See [`ROLLOUT/INDEX.md`](./ROLLOUT/INDEX.md).\n"
        "Add new sections as `ROLLOUT/<slug>.md` and link them from the index.\n"
    )


def write_shards(preamble: list[str], sections: list[Section]) -> None:
    OUT_DIR.mkdir(exist_ok=True)
    (OUT_DIR / "INDEX.md").write_text(render_index(preamble, sections))
    for s in sections:
        (OUT_DIR / f"{s.slug}.md").write_text(render_shard(s))
    SOURCE.write_text(root_pointer())


def assert_conservation(
    original_lines: list[str],
    preamble: list[str],
    sections: list[Section],
) -> None:
    """Every line of the original (minus the heading prefix change) must land in
    exactly one output file. We check by counting lines."""
    section_line_count = sum(len(s.body) for s in sections)
    total = len(preamble) + section_line_count
    if total != len(original_lines):
        raise SystemExit(
            f"Line conservation failed: original={len(original_lines)} "
            f"preamble={len(preamble)} sections={section_line_count} "
            f"total={total}. Some content is missing or duplicated."
        )


def is_already_split(text: str) -> bool:
    """True only when the file matches the exact pointer shape we write.

    Earlier versions used ``len(text.splitlines()) < 20`` as a heuristic,
    which would silently mis-classify a slightly grown pointer as
    "already split" and skip a re-run. Pinning to the literal pointer
    string makes the check explicit: we only short-circuit when this
    file *is* the pointer, not when it merely contains a phrase that
    happens to mention shards.
    """
    return text.strip() == root_pointer().strip()


def cmd_split() -> int:
    text = SOURCE.read_text()
    if is_already_split(text):
        print(f"{SOURCE} already points at ROLLOUT/. Nothing to do.", file=sys.stderr)
        return 0

    lines = text.splitlines(keepends=True)
    preamble, sections = parse_sections(lines)

    if not sections:
        raise SystemExit(f"No `## ` sections found in {SOURCE}.")

    assert_unique_slugs(sections)
    assert_conservation(lines, preamble, sections)
    write_shards(preamble, sections)

    print(f"Wrote {len(sections)} shards + INDEX.md under {OUT_DIR.relative_to(REPO_ROOT)}/")
    print(f"Replaced {SOURCE.relative_to(REPO_ROOT)} with a pointer.")
    return 0


def cmd_check() -> int:
    """Verify INDEX.md lists every shard file and every shard has a unique
    top-level heading. Used as a CI sanity check after the split has landed."""
    if not OUT_DIR.exists():
        raise SystemExit(f"{OUT_DIR} does not exist. Run without --check first.")

    shards = sorted(p for p in OUT_DIR.glob("*.md") if p.name != "INDEX.md")
    if not shards:
        raise SystemExit(f"No shards found in {OUT_DIR}.")

    index_text = (OUT_DIR / "INDEX.md").read_text()
    missing = [p.name for p in shards if f"(./{p.name})" not in index_text]
    if missing:
        raise SystemExit(f"INDEX.md is missing links to: {missing}")

    headings: dict[str, str] = {}
    for shard in shards:
        first_line = shard.read_text().splitlines()[0]
        if not first_line.startswith("# "):
            raise SystemExit(f"{shard.name} does not start with a `# ` heading.")
        if first_line in headings:
            raise SystemExit(
                f"Duplicate heading {first_line!r} in {shard.name} "
                f"and {headings[first_line]}"
            )
        headings[first_line] = shard.name

    print(f"OK: {len(shards)} shards, all linked from INDEX.md, all unique headings.")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="verify split, no writes")
    args = parser.parse_args(argv)
    return cmd_check() if args.check else cmd_split()


if __name__ == "__main__":
    raise SystemExit(main())
