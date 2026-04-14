"""Harvard Square Business Association, Cambridge Chamber, Somerville Chamber,
Greater Boston Chamber, ArtsBoston — HTML member directories.

These are small, high-signal lists. Scrape once, cache locally.
"""
from __future__ import annotations

import requests
from bs4 import BeautifulSoup
from tenacity import retry, stop_after_attempt, wait_exponential

SOURCES = {
    "hsba":          "https://www.harvardsquare.com/businesses/",
    "cambridge_cc":  "https://members.cambridgechamber.org/list",
    "somerville_cc": "https://business.somervillechamber.org/list",
    "gbcc":          "https://www.bostonchamber.com/membership/member-directory/",
    "artsboston":    "https://www.artsboston.org/members/",
}

UA = "Mozilla/5.0 (whrb-prospects research crawler)"


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=2, max=30))
def _get(url: str) -> str:
    r = requests.get(url, headers={"User-Agent": UA}, timeout=30)
    r.raise_for_status()
    return r.text


def _extract_generic(html: str, source_key: str) -> list[dict]:
    """Heuristic extractor — each chamber uses a different template, so we
    look for anchor tags inside list items / cards that link to member pages.
    """
    soup = BeautifulSoup(html, "lxml")
    rows: list[dict] = []
    for a in soup.select("a"):
        name = (a.get_text() or "").strip()
        href = a.get("href") or ""
        if len(name) < 3 or len(name) > 80:
            continue
        if not href.startswith("http"):
            continue
        # Filter out obvious navigation links
        if any(w in name.lower() for w in ("home", "about", "contact us", "login", "search")):
            continue
        rows.append({
            "source": source_key,
            "tier": "B",
            "company_name": name,
            "website": href,
            "notes": f"member:{source_key}",
        })
    # Dedup within this chamber by name
    seen = set()
    out = []
    for r in rows:
        k = r["company_name"].lower()
        if k in seen:
            continue
        seen.add(k)
        out.append(r)
    return out


def run_all() -> list[dict]:
    rows: list[dict] = []
    for key, url in SOURCES.items():
        try:
            html = _get(url)
            found = _extract_generic(html, key)
            print(f"[{key}] {len(found)} rows")
            rows.extend(found)
        except Exception as e:
            print(f"[{key}] failed: {e}")
    return rows
