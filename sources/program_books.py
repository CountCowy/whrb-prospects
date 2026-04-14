"""BSO / A.R.T. / Huntington / Celebrity Series program book PDFs.

Drop downloaded PDFs into data/program_books/. Extracts text and pulls out
likely sponsor names (uppercase blocks in ad sections).
"""
from __future__ import annotations

import re
from pathlib import Path

import pdfplumber

PDF_DIR = Path("data/program_books")

NAME_RE = re.compile(r"^[A-Z][A-Z &'\.\-]{4,60}$")


def run_all() -> list[dict]:
    if not PDF_DIR.exists():
        print(f"[program_books] {PDF_DIR} not found; skipping")
        return []
    rows: list[dict] = []
    for pdf_path in PDF_DIR.glob("*.pdf"):
        try:
            with pdfplumber.open(pdf_path) as pdf:
                for page in pdf.pages:
                    text = page.extract_text() or ""
                    for line in text.splitlines():
                        line = line.strip()
                        if NAME_RE.match(line):
                            rows.append({
                                "source": f"program_book:{pdf_path.stem}",
                                "tier": "A",
                                "company_name": line.title(),
                                "notes": "prints_in_program_book",
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
