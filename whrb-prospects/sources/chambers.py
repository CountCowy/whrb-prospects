"""Per-source chamber / association scrapers.

HSBA and ArtsBoston are static HTML and usable. Cambridge CC, Somerville CC,
and Greater Boston CC all run GrowthZone / Beaver Builder JS-rendered
directories — they return nothing useful to a static scraper and are dropped
from the default run until we add a Playwright-based fetcher.
"""
from __future__ import annotations

import json
import time

import requests
from bs4 import BeautifulSoup

from util.http import raise_for_smart_status, smart_retry

UA = "Mozilla/5.0 (whrb-prospects research crawler)"

SOCIAL_DOMAINS = (
    "facebook.com", "twitter.com", "instagram.com", "youtube.com",
    "linkedin.com", "tiktok.com", "pinterest.com", "yelp.com",
    "tripadvisor.com",
)


@smart_retry()
def _get(url: str) -> str:
    r = requests.get(url, headers={"User-Agent": UA}, timeout=30)
    raise_for_smart_status(r)
    return r.text


def _scrape_hsba_detail(detail_url: str) -> dict:
    """Fetch a single HSBA detail page and extract the real business website,
    phone, and address from HTML links + JSON-LD LocalBusiness schema."""
    info: dict = {}
    try:
        html = _get(detail_url)
    except Exception:
        return info
    soup = BeautifulSoup(html, "lxml")

    # Real website: <a> with text "Website"
    website_link = soup.find("a", string="Website")
    if website_link and website_link.get("href"):
        href = website_link["href"]
        if "harvardsquare.com" not in href:
            info["website"] = href

    # Phone: <a href="tel:...">
    phone_link = soup.find("a", href=lambda h: h and h.startswith("tel:"))
    if phone_link:
        info["company_phone"] = phone_link.get_text(strip=True)

    # JSON-LD for address
    ld_script = soup.find("script", type="application/ld+json")
    if ld_script and ld_script.string:
        try:
            ld = json.loads(ld_script.string)
            addr = ld.get("address") or {}
            parts = [
                addr.get("streetAddress"),
                addr.get("addressLocality"),
                addr.get("addressRegion"),
                addr.get("postalCode"),
            ]
            address = ", ".join(p for p in parts if p)
            if address:
                info["address"] = address
            if addr.get("postalCode"):
                info["zip"] = addr["postalCode"][:5]
        except (json.JSONDecodeError, TypeError):
            pass

    return info


def _scrape_hsba() -> list[dict]:
    """Harvard Square Business Association — /places/ WordPress archive,
    ~356 businesses, 12 pages paginated via ?paged=N.

    Two passes: (1) collect names + directory URLs from listing pages,
    (2) visit each detail page to extract the real business website, phone,
    and address."""
    # Pass 1: listing pages
    raw: list[dict] = []
    for page_num in range(1, 13):
        url = f"https://www.harvardsquare.com/places/?paged={page_num}"
        try:
            html = _get(url)
        except Exception as e:
            print(f"[hsba] page {page_num} failed: {e}")
            continue
        soup = BeautifulSoup(html, "lxml")
        for a in soup.select('a[href*="/places/"][href$="/"]'):
            h3 = a.find("h3")
            if not h3:
                continue
            name = h3.get_text(strip=True)
            if not name:
                continue
            raw.append({
                "source": "hsba",
                "tier": "B",
                "company_name": name,
                "_detail_url": a.get("href"),
                "pipeline_notes": "member:hsba",
            })
    # Dedup by name
    seen, unique = set(), []
    for r in raw:
        k = r["company_name"].lower()
        if k in seen:
            continue
        seen.add(k)
        unique.append(r)

    # Pass 2: detail pages (polite: 0.3s delay, requests-cache will help on re-runs)
    print(f"[hsba] fetching {len(unique)} detail pages...")
    for i, r in enumerate(unique):
        detail_url = r.pop("_detail_url", None)
        if not detail_url:
            continue
        info = _scrape_hsba_detail(detail_url)
        for k, v in info.items():
            if v:
                r[k] = v
        # If no real website found, leave website blank rather than the directory URL
        if "website" not in r:
            r["website"] = None
        if (i + 1) % 50 == 0:
            print(f"[hsba] {i + 1}/{len(unique)} detail pages")
        time.sleep(0.3)

    return unique


def _scrape_artsboston() -> list[dict]:
    """ArtsBoston current-members — static HTML (Jupiter WordPress theme),
    ~90 arts orgs organized by discipline. Member orgs are hyperlinks to their
    own websites."""
    try:
        html = _get("https://www.artsboston.org/current-members/")
    except Exception as e:
        print(f"[artsboston] failed: {e}")
        return []
    soup = BeautifulSoup(html, "lxml")
    rows: list[dict] = []
    # Broad selector: all external http links. Filter out artsboston.org
    # self-links and social media domains. Theme-agnostic.
    for a in soup.select('a[href^="http"]'):
        href = a.get("href", "")
        if "artsboston.org" in href:
            continue
        if any(d in href for d in SOCIAL_DOMAINS):
            continue
        name = a.get_text(strip=True)
        if len(name) < 3 or len(name) > 80:
            continue
        rows.append({
            "source": "artsboston",
            "tier": "A",
            "company_name": name,
            "website": href,
            "pipeline_notes": "member:artsboston",
        })
    # Dedup
    seen, out = set(), []
    for r in rows:
        k = r["company_name"].lower()
        if k in seen:
            continue
        seen.add(k)
        out.append(r)
    return out


def run_all() -> list[dict]:
    rows: list[dict] = []
    for label, fn in (
        ("hsba",       _scrape_hsba),
        ("artsboston", _scrape_artsboston),
    ):
        try:
            r = fn()
            print(f"[chambers/{label}] {len(r)} rows")
            rows.extend(r)
        except Exception as e:
            print(f"[chambers/{label}] failed: {e}")
    return rows

# Cambridge CC, Somerville CC, Greater Boston CC all run JS-rendered
# GrowthZone/Beaver Builder directories. Static scraping returns nothing.
# Reinstate when we add a Playwright fetcher or find an XML/API feed.
