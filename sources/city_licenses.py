"""City open data portals — Socrata APIs (free, no key required for light use).

Cambridge: https://data.cambridgema.gov
Somerville: https://data.somervillema.gov
Boston: https://data.boston.gov  (CKAN, not Socrata)
"""
from __future__ import annotations

import requests
from tenacity import retry, stop_after_attempt, wait_exponential

from config import WHRB_ZIPS

# Cambridge business certificates dataset id changes occasionally — update here.
CAMBRIDGE_URL = "https://data.cambridgema.gov/resource/bsa7-v7sx.json"  # example id
SOMERVILLE_URL = "https://data.somervillema.gov/resource/business-licenses.json"


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=2, max=30))
def _get(url: str, params: dict) -> list[dict]:
    r = requests.get(url, params=params, timeout=60)
    r.raise_for_status()
    return r.json()


def _fetch_socrata(url: str, source: str) -> list[dict]:
    rows: list[dict] = []
    try:
        data = _get(url, {"$limit": 5000})
    except Exception as e:
        print(f"[{source}] fetch failed: {e}")
        return rows
    for rec in data:
        zip_code = (rec.get("zip") or rec.get("zipcode") or "")[:5]
        if zip_code and zip_code not in WHRB_ZIPS:
            continue
        rows.append({
            "source": source,
            "tier": "C",
            "company_name": rec.get("business_name") or rec.get("dba") or rec.get("name"),
            "address": rec.get("address") or rec.get("location_address"),
            "zip": zip_code,
            "category": rec.get("business_type") or rec.get("license_type"),
        })
    return [r for r in rows if r["company_name"]]


def run_all() -> list[dict]:
    rows = []
    rows += _fetch_socrata(CAMBRIDGE_URL, "cambridge_open_data")
    rows += _fetch_socrata(SOMERVILLE_URL, "somerville_open_data")
    print(f"[city_licenses] {len(rows)} rows")
    return rows
