"""MA Home Improvement Contractor registry — no CSV dump exists.

Two lookup paths, both live:

1. LEGACY (preferred): https://services.oca.state.ma.us/hic/licenseelist.aspx
   Classic ASP.NET WebForms. Plain HTML, `requests` works. Must GET once to
   capture __VIEWSTATE / __EVENTVALIDATION / __VIEWSTATEGENERATOR, then POST
   with the city filter. Pagination uses __doPostBack('dgResults','Page$N').

2. MODERN: https://contractorhub.mass.gov/s/hic-contractor-search
   Salesforce Lightning (JS-rendered). Playwright fallback only.

Strategy: iterate WHRB_CITIES through the legacy portal. Fall back to Playwright
against contractorhub if the legacy endpoint returns 5xx.
"""
from __future__ import annotations

import re
import time

import requests
from bs4 import BeautifulSoup

from util.http import raise_for_smart_status, smart_retry

LEGACY_URL = "https://services.oca.state.ma.us/hic/licenseelist.aspx"
MODERN_URL = "https://contractorhub.mass.gov/s/hic-contractor-search"

WHRB_CITIES = [
    "Cambridge", "Somerville", "Brookline", "Boston",
    "Belmont", "Watertown", "Arlington", "Allston", "Brighton",
    "Jamaica Plain", "Roxbury", "Dorchester",
]

UA = "Mozilla/5.0 (whrb-prospects research crawler; contact: whrb.org)"
HEADERS = {"User-Agent": UA, "Accept": "text/html,application/xhtml+xml"}


# ---------- legacy ASP.NET path ---------- #

def _parse_viewstate(html: str) -> dict:
    """Extract the hidden ASP.NET form fields needed to POST back."""
    soup = BeautifulSoup(html, "lxml")
    fields = {}
    for name in ("__VIEWSTATE", "__VIEWSTATEGENERATOR", "__EVENTVALIDATION",
                 "__EVENTTARGET", "__EVENTARGUMENT"):
        el = soup.find("input", {"name": name})
        fields[name] = el["value"] if el and el.has_attr("value") else ""
    return fields


@smart_retry(wait_min=3, wait_max=30)
def _get_form(session: requests.Session) -> dict:
    r = session.get(LEGACY_URL, headers=HEADERS, timeout=30)
    raise_for_smart_status(r)
    return _parse_viewstate(r.text)


@smart_retry(wait_min=3, wait_max=30)
def _post_city(session: requests.Session, state: dict, city: str) -> str:
    # Field names are best-effort — ASP.NET page was built ~2005 and
    # historically used txtCity / btnSearch. Adjust if the live page differs.
    payload = {
        **state,
        "txtBusinessName": "",
        "txtCity": city,
        "txtZip": "",
        "txtRegNo": "",
        "btnSearch": "Search",
    }
    r = session.post(LEGACY_URL, data=payload, headers=HEADERS, timeout=60)
    raise_for_smart_status(r)
    return r.text


def _parse_results(html: str, city: str) -> list[dict]:
    soup = BeautifulSoup(html, "lxml")
    table = (
        soup.find("table", {"id": "dgResults"})
        or soup.find("table", {"id": re.compile("Results", re.I)})
    )
    if not table:
        return []
    rows: list[dict] = []
    headers = [th.get_text(strip=True).lower() for th in table.find_all("th")]
    for tr in table.find_all("tr"):
        cells = [td.get_text(" ", strip=True) for td in tr.find_all("td")]
        if len(cells) < 2:
            continue
        rec = dict(zip(headers, cells)) if headers else {}
        # Heuristic field detection when header mapping fails
        name = rec.get("business name") or rec.get("name") or cells[0]
        reg = rec.get("registration") or rec.get("reg no") or ""
        phone = next((c for c in cells if re.search(r"\d{3}[.\-\s]\d{3}", c)), None)
        rows.append({
            "source": "ma_hic_legacy",
            "tier": "C",
            "company_name": name,
            "company_phone": phone,
            "address": rec.get("address") or None,
            "zip": (rec.get("zip") or "")[:5] or None,
            "category": "home_improvement_contractor",
            "notes": f"hic_reg:{reg}" if reg else "hic_legacy",
        })
    return [r for r in rows if r["company_name"]]


def _legacy_fetch() -> list[dict]:
    session = requests.Session()
    session.headers.update(HEADERS)
    rows: list[dict] = []
    for city in WHRB_CITIES:
        try:
            state = _get_form(session)
            html = _post_city(session, state, city)
            city_rows = _parse_results(html, city)
            print(f"[ma_hic legacy] {city}: {len(city_rows)}")
            rows.extend(city_rows)
            time.sleep(2)
        except Exception as e:
            print(f"[ma_hic legacy] {city} failed: {e}")
            # bubble up so caller can try Playwright fallback on total failure
            if not rows:
                raise
    return rows


# ---------- modern Salesforce Lightning fallback ---------- #

def _modern_fetch() -> list[dict]:
    """Playwright scrape of contractorhub.mass.gov. Slower but works when
    the legacy endpoint is down."""
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("[ma_hic modern] playwright not installed")
        return []
    rows: list[dict] = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        for city in WHRB_CITIES:
            try:
                page.goto(MODERN_URL, timeout=45000)
                page.wait_for_selector("input[name*='city' i], input[placeholder*='city' i]",
                                       timeout=20000)
                city_input = page.query_selector(
                    "input[name*='city' i], input[placeholder*='city' i]"
                )
                if not city_input:
                    continue
                city_input.fill(city)
                page.keyboard.press("Enter")
                page.wait_for_load_state("networkidle", timeout=20000)
                # Result rows render as Lightning cards or table rows
                for row in page.query_selector_all("[data-row-key-value], tr, .slds-card"):
                    text = row.inner_text().strip()
                    if len(text) < 10 or "contractor" in text.lower()[:30]:
                        continue
                    lines = [l.strip() for l in text.splitlines() if l.strip()]
                    if not lines:
                        continue
                    rows.append({
                        "source": "ma_hic_modern",
                        "tier": "C",
                        "company_name": lines[0],
                        "address": " ".join(lines[1:3]),
                        "category": "home_improvement_contractor",
                        "notes": "hic_modern",
                    })
                print(f"[ma_hic modern] {city}: done")
            except Exception as e:
                print(f"[ma_hic modern] {city} failed: {e}")
        browser.close()
    return rows


def run_all() -> list[dict]:
    try:
        rows = _legacy_fetch()
        if rows:
            print(f"[ma_hic] {len(rows)} rows via legacy portal")
            return rows
    except Exception as e:
        print(f"[ma_hic] legacy path failed entirely: {e}; trying modern")
    rows = _modern_fetch()
    print(f"[ma_hic] {len(rows)} rows via modern portal")
    return rows
