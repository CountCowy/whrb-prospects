"""BSO / A.R.T. / Huntington / Celebrity Series program book PDFs.

Drop downloaded PDFs into data/program_books/. Extracts text and pulls out
likely sponsor names (uppercase blocks in ad sections).

Noise-reduction rules (see Issue 4 in CLAUDE.md):
- Skip PDFs whose filename suggests a financial / annual report — those are
  full of uppercase section headings that match the sponsor regex.
- Only extract from pages whose text contains a sponsor-context marker
  ("sponsor", "thanks to", "supported by", "in partnership with", ...).
- Drop single-word matches — real sponsor names are almost always ≥2 words.
- Drop blocklisted boilerplate ("HARVARD RADIO BROADCASTING", "WHRB", etc.).
"""
from __future__ import annotations

import re
from pathlib import Path

import pdfplumber

from util.tags import build_tag_set

PDF_DIR = Path("data/program_books")

# Program-book filename → genre emission. Keys match the stem (lowercased).
# Multi-genre values are emitted as lists (e.g. Handel+Haydn prints both
# classical and choral program books).
_GENRE_BY_STEM: dict[str, list[str]] = {
    "bso":          ["classical"],   # Boston Symphony
    "boston_symphony": ["classical"],
    "h_and_h":      ["classical", "choral"],  # Handel & Haydn
    "handel_and_haydn": ["classical", "choral"],
    "handel_haydn": ["classical", "choral"],
    "blo":          ["opera"],       # Boston Lyric Opera
    "boston_lyric": ["opera"],
    "celebrity_series": ["classical"],
    "celebrity":    ["classical"],
    "art":          ["theatre"],     # American Repertory Theater
    "a_r_t":        ["theatre"],
    "huntington":   ["theatre"],
    "bemf":         ["classical"],   # Boston Early Music Festival
    "early_music":  ["classical"],
    "boston_ballet": ["dance"],
}


def _infer_genres(stem: str) -> list[str]:
    """Guess genre(s) from the PDF filename stem."""
    low = stem.lower()
    for key, genres in _GENRE_BY_STEM.items():
        if key in low:
            return genres
    return []

# Two-or-more uppercase words (allowing & ' . -) — single-word ALL-CAPS lines
# are overwhelmingly section headings, not sponsor names.
NAME_RE = re.compile(r"^[A-Z][A-Z&'\.\-]*(?:\s+[A-Z][A-Z&'\.\-]*)+$")

# If any of these substrings appear in the PDF filename (case-insensitive),
# skip the file entirely — financial / annual reports have many uppercase
# section headings that look like sponsors.
FILENAME_EXCLUDE = (
    "financial",
    "annual-report",
    "annual_report",
    "annualreport",
    "form-990",
    "form990",
    "audit",
    "tax-return",
    "10-k",
    "10k",
)

# A page must contain one of these markers to be considered a sponsor context.
# Keeps us out of donor-listing / staff-masthead / editorial pages.
SPONSOR_CONTEXT_MARKERS = (
    "sponsor",
    "thanks to",
    "supported by",
    "in partnership with",
    "generous support",
    "underwritten by",
    "our partners",
    "corporate partner",
    "season sponsor",
    "presenting sponsor",
    "media partner",
)

# Names that are obviously not prospect businesses — station / program / award
# boilerplate that tends to leak through the regex.
NAME_BLOCKLIST = {
    "HARVARD RADIO BROADCASTING",
    "WHRB FM",
    "WHRB 95.3 FM",
    "BOSTON SYMPHONY ORCHESTRA",
    "SYMPHONY HALL",
    "TANGLEWOOD MUSIC CENTER",
    "UNITED STATES OF AMERICA",
    "NEW YORK TIMES",
    "BOSTON GLOBE",
    "PUBLIC BROADCASTING",
    "NATIONAL PUBLIC RADIO",
}


def _filename_excluded(pdf_path: Path) -> bool:
    lower = pdf_path.name.lower()
    return any(token in lower for token in FILENAME_EXCLUDE)


def _page_has_sponsor_context(text: str) -> bool:
    lower = text.lower()
    return any(marker in lower for marker in SPONSOR_CONTEXT_MARKERS)


def _is_acceptable_name(line: str) -> bool:
    if not NAME_RE.match(line):
        return False
    if line in NAME_BLOCKLIST:
        return False
    # NAME_RE already enforces ≥2 whitespace-separated tokens, but double-check
    # in case the regex is relaxed later.
    if len(line.split()) < 2:
        return False
    if len(line) < 6 or len(line) > 80:
        return False
    return True


def run_all(auto_fetch: bool = True) -> list[dict]:
    if auto_fetch:
        # Download fresh PDFs from BSO / H&H / Celebrity Series before parsing
        from sources import program_books_fetcher
        program_books_fetcher.fetch_all()
    if not PDF_DIR.exists():
        print(f"[program_books] {PDF_DIR} not found; skipping")
        return []
    rows: list[dict] = []
    for pdf_path in PDF_DIR.glob("*.pdf"):
        if _filename_excluded(pdf_path):
            print(f"[program_books] skipping (report-like filename): {pdf_path.name}")
            continue
        try:
            with pdfplumber.open(pdf_path) as pdf:
                for page in pdf.pages:
                    text = page.extract_text() or ""
                    if not _page_has_sponsor_context(text):
                        continue
                    genres = _infer_genres(pdf_path.stem)
                    tag_payload = build_tag_set(
                        sector=["arts", "nonprofit"],
                        genre=genres or None,
                        history="program_book_sponsor",
                        source=f"program_book:{pdf_path.stem}",
                    )
                    for line in text.splitlines():
                        line = line.strip()
                        if not _is_acceptable_name(line):
                            continue
                        rows.append({
                            "source": f"program_book:{pdf_path.stem}",
                            "tier": "A",
                            "company_name": line.title(),
                            "pipeline_notes": "prints_in_program_book",
                            "tags": {k: list(v) for k, v in tag_payload.items()},
                        })
        except Exception as e:
            print(f"[program_books] {pdf_path.name}: {e}")
    # Dedup
    seen = set()
    out = []
    for r in rows:
        k = r["company_name"].lower()
        if k in seen:
            continue
        seen.add(k)
        out.append(r)
    print(f"[program_books] {len(out)} unique names")
    return out
