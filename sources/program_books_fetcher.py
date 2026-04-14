"""Auto-download arts-org program books into data/program_books/.

Runs before program_books.py parses them. Each fetcher targets one org's
actual publishing pattern (researched live — see notes).

Sources & mechanics:
- Handel & Haydn: Preservica archive, 1818–2016, downloadable PDFs.
  https://handelandhaydn.access.preservica.com/
- Celebrity Series / Vivo: S3-hosted PDFs + InstantEncore HTML programs.
  https://www.vivoperformingarts.org/programbook/
- BSO: season brochure PDFs on cdn.bso.org. Per-concert programs are HTML
  only (no PDF) — the season brochures still list major sponsors.
  https://www.bso.org/seasons/...
- Huntington: no public program PDFs; sponsor page is HTML.
  Handled separately in huntington_sponsors() which returns rows directly.
- A.R.T. / Boston Lyric Opera: publish via Issuu, which gates PDF downloads.
  Skipped by default — set ENABLE_ISSUU=True if you add an Issuu extractor.
"""
from __future__ import annotations

import re
import time
from pathlib import Path
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup
from tenacity import retry, stop_after_attempt, wait_exponential

PDF_DIR = Path("data/program_books")
PDF_DIR.mkdir(parents=True, exist_ok=True)

UA = "Mozilla/5.0 (whrb-prospects research crawler)"
HEADERS = {"User-Agent": UA}

MAX_PER_ORG = 12  # keep the run bounded
ENABLE_ISSUU = False


# ------------------ generic helpers ------------------ #

@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=2, max=20))
def _get(url: str) -> requests.Response:
    r = requests.get(url, headers=HEADERS, timeout=45)
    r.raise_for_status()
    return r


def _save_pdf(url: str, org: str) -> Path | None:
    try:
        r = _get(url)
    except Exception as e:
        print(f"[fetcher:{org}] {url}: {e}")
        return None
    ctype = r.headers.get("content-type", "").lower()
    if "pdf" not in ctype and not url.lower().endswith(".pdf"):
        return None
    slug = re.sub(r"[^\w.-]+", "_", urlparse(url).path.rsplit("/", 1)[-1])
    if not slug.lower().endswith(".pdf"):
        slug += ".pdf"
    dest = PDF_DIR / f"{org}__{slug}"
    if dest.exists():
        return dest
    dest.write_bytes(r.content)
    print(f"[fetcher:{org}] saved {dest.name} ({len(r.content)//1024} KB)")
    return dest


# ------------------ BSO ------------------ #

BSO_INDEX_URLS = [
    "https://www.bso.org/seasons",
    "https://www.bso.org/about/annual-reports",
]


def fetch_bso() -> list[Path]:
    saved = []
    for index in BSO_INDEX_URLS:
        try:
            html = _get(index).text
        except Exception as e:
            print(f"[fetcher:bso] {index}: {e}")
            continue
        soup = BeautifulSoup(html, "lxml")
        for a in soup.find_all("a", href=True):
            href = a["href"]
            if href.lower().endswith(".pdf") and ("brochure" in href.lower()
                                                  or "annual" in href.lower()
                                                  or "program" in href.lower()):
                full = urljoin(index, href)
                p = _save_pdf(full, "bso")
                if p:
                    saved.append(p)
                    if len(saved) >= MAX_PER_ORG:
                        return saved
        time.sleep(1)
    return saved


# ------------------ Handel & Haydn (Preservica) ------------------ #

HH_PRESERVICA_BASE = "https://handelandhaydn.access.preservica.com"
HH_LISTING_PATH = "/uncategorized/"


def fetch_handel_haydn() -> list[Path]:
    """Preservica listing page exposes items as /uncategorized/IO_{uuid}/ pages.
    Each item page carries a 'Download' link to the underlying PDF."""
    saved = []
    try:
        html = _get(HH_PRESERVICA_BASE + HH_LISTING_PATH).text
    except Exception as e:
        print(f"[fetcher:hh] listing failed: {e}")
        return saved
    soup = BeautifulSoup(html, "lxml")
    item_paths = {
        a["href"] for a in soup.find_all("a", href=True)
        if "/IO_" in a["href"]
    }
    print(f"[fetcher:hh] {len(item_paths)} items on first page")
    for path in list(item_paths)[:MAX_PER_ORG]:
        try:
            item_html = _get(urljoin(HH_PRESERVICA_BASE, path)).text
        except Exception as e:
            print(f"[fetcher:hh] {path}: {e}")
            continue
        item_soup = BeautifulSoup(item_html, "lxml")
        dl = item_soup.find("a", href=re.compile(r"download|\.pdf", re.I))
        if not dl:
            continue
        pdf_url = urljoin(HH_PRESERVICA_BASE, dl["href"])
        p = _save_pdf(pdf_url, "hh")
        if p:
            saved.append(p)
        time.sleep(1)
    return saved


# ------------------ Celebrity Series / Vivo ------------------ #

VIVO_INDEX = "https://www.vivoperformingarts.org/programbook/"
CELEBRITY_S3 = "https://celebrity-series.s3.amazonaws.com/files/resources/"


def fetch_celebrity_series() -> list[Path]:
    saved = []
    try:
        html = _get(VIVO_INDEX).text
    except Exception as e:
        print(f"[fetcher:vivo] {e}")
        return saved
    soup = BeautifulSoup(html, "lxml")
    pdf_links = {
        urljoin(VIVO_INDEX, a["href"])
        for a in soup.find_all("a", href=True)
        if a["href"].lower().endswith(".pdf")
        or "celebrity-series.s3" in a["href"]
    }
    print(f"[fetcher:vivo] {len(pdf_links)} PDF candidates")
    for url in list(pdf_links)[:MAX_PER_ORG]:
        p = _save_pdf(url, "celseries")
        if p:
            saved.append(p)
    return saved


# ------------------ Huntington sponsor page (HTML → rows, not PDFs) ------------------ #

HUNTINGTON_SPONSORS_URL = "https://huntingtontheatre.org/about/sponsors/"


def huntington_sponsors() -> list[dict]:
    """Returns rows directly — no PDF intermediary. Called from pipeline alongside
    the PDF-based program_books source."""
    try:
        html = _get(HUNTINGTON_SPONSORS_URL).text
    except Exception as e:
        print(f"[fetcher:huntington] {e}")
        return []
    soup = BeautifulSoup(html, "lxml")
    rows = []
    # Sponsor logos typically live in <img alt="Sponsor Name"> inside a sponsor section
    for img in soup.find_all("img", alt=True):
        alt = img["alt"].strip()
        if 4 <= len(alt) <= 80 and not any(
            w in alt.lower() for w in ("logo", "huntington", "icon", "arrow")
        ):
            rows.append({
                "source": "huntington_sponsors",
                "tier": "A",
                "company_name": alt,
                "notes": "huntington_sponsor",
            })
    # Dedup
    seen, out = set(), []
    for r in rows:
        k = r["company_name"].lower()
        if k in seen:
            continue
        seen.add(k)
        out.append(r)
    print(f"[fetcher:huntington] {len(out)} sponsor names")
    return out


# ------------------ A.R.T. / BLO (Issuu) ------------------ #

def fetch_issuu_placeholder() -> list[Path]:
    if not ENABLE_ISSUU:
        return []
    # A.R.T.: https://issuu.com/americanrep
    # BLO:    https://issuu.com/bostonlyricopera
    # Issuu gates PDF downloads; plug in a real extractor here if you add one.
    print("[fetcher:issuu] skipped (gated — set ENABLE_ISSUU=True)")
    return []


# ------------------ orchestrator ------------------ #

def fetch_all() -> None:
    """Download every available program book into data/program_books/."""
    print("== program book fetcher ==")
    fetch_bso()
    fetch_handel_haydn()
    fetch_celebrity_series()
    fetch_issuu_placeholder()
    total = len(list(PDF_DIR.glob("*.pdf")))
    print(f"[fetcher] {total} total PDFs in {PDF_DIR}")


if __name__ == "__main__":
    fetch_all()
