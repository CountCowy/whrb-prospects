"""Boston Magazine "Best of Boston" winners — annual, static HTML per category."""
from __future__ import annotations

import requests
from bs4 import BeautifulSoup

BASE = "https://www.bostonmagazine.com/best-of-boston/"
UA = "Mozilla/5.0 (whrb-prospects research crawler)"


def run_all() -> list[dict]:
    try:
        r = requests.get(BASE, headers={"User-Agent": UA}, timeout=30)
        r.raise_for_status()
    except Exception as e:
        print(f"[best_of_boston] {e}")
        return []
    soup = BeautifulSoup(r.text, "lxml")
    rows: list[dict] = []
    for entry in soup.select("article, .winner, .boB-winner"):
        name_el = entry.select_one("h2, h3, .name")
        cat_el = entry.select_one(".category, .tag")
        if not name_el:
            continue
        rows.append({
            "source": "best_of_boston",
            "tier": "B",
            "company_name": name_el.get_text(strip=True),
            "category": cat_el.get_text(strip=True) if cat_el else None,
            "notes": "best_of_boston_winner",
        })
    print(f"[best_of_boston] {len(rows)} rows")
    return rows
