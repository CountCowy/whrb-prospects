"""City open data portals — Socrata (Cambridge, Somerville) + CKAN (Boston).

Three verified datasets:
- Cambridge Business Diversity Directory (Socrata 2b3j-9kdn)
- Somerville Applications for Permits and Licenses (Socrata nneb-s3f7)
- Boston Food Establishment Licenses (CKAN f1e13724-...)

Field names are best-effort from typical Socrata/CKAN schemas; runtime code
falls back across several common column names. If a dataset returns rows with
an empty company_name, hit the endpoint with $limit=1 to see its real schema
and update the getter chain.
"""
from __future__ import annotations

import requests

from config import (
    BOSTON_FOOD_MAX_ROWS,
    BOSTON_FOOD_OFFSET_CEILING,
    BOSTON_FOOD_PAGE_SIZE,
    SOCRATA_PAGE_LIMIT,
)
from util.http import raise_for_smart_status, smart_retry

# Cambridge Open Data (Socrata)
CAMBRIDGE_DIVERSITY_URL = "https://data.cambridgema.gov/resource/2b3j-9kdn.json"

# Somerville Open Data (Socrata)
SOMERVILLE_PERMITS_URL = "https://data.somervillema.gov/resource/nneb-s3f7.json"

# Boston Open Data (CKAN)
BOSTON_CKAN_BASE = "https://data.boston.gov/api/3/action/datastore_search"
BOSTON_FOOD_RESOURCE_ID = "f1e13724-284d-478c-b8bc-ef042aa5b70b"


@smart_retry()
def _get_json(url: str, params: dict | None = None):
    r = requests.get(url, params=params, timeout=30)
    raise_for_smart_status(r)
    return r.json()


def _pick(rec: dict, *keys: str):
    for k in keys:
        v = rec.get(k)
        if v:
            # Socrata URL-type fields come back as {"url": "...", "description": "..."}.
            # Unwrap so downstream code always sees a string.
            if isinstance(v, dict):
                v = v.get("url") or v.get("href")
                if not v:
                    continue
            return v
    return None


def _fetch_cambridge_diversity() -> list[dict]:
    data = _get_json(CAMBRIDGE_DIVERSITY_URL, {"$limit": SOCRATA_PAGE_LIMIT})
    rows = []
    for r in data:
        name = _pick(r, "bus_name", "business_name", "name", "dba")
        if not name:
            continue
        rows.append({
            "source": "cambridge_diversity",
            "tier": "B",
            "company_name": name,
            "website": _pick(r, "website", "url"),
            "address": _pick(r, "address", "location_address"),
            "category": _pick(r, "bus_category", "business_category", "category"),
            "contact_name": _pick(r, "owner", "owner_name"),
            "pipeline_notes": "cambridge_diversity_directory",
        })
    return rows


def _looks_like_business_permit(rec: dict) -> bool:
    t = (_pick(rec, "application_type", "permit_type", "type") or "").lower()
    return any(w in t for w in (
        "business", "license", "food", "liquor", "entertainment", "occupancy"
    ))


def _fetch_somerville_permits() -> list[dict]:
    data = _get_json(SOMERVILLE_PERMITS_URL, {
        "$limit": SOCRATA_PAGE_LIMIT,
        "$order": "date_application_submitted DESC",
    })
    rows = []
    for r in data:
        if not _looks_like_business_permit(r):
            continue
        name = _pick(r, "applicant_name", "applicant", "business_name")
        if not name:
            continue
        rows.append({
            "source": "somerville_permits",
            "tier": "C",
            "company_name": name,
            "address": _pick(r, "address", "location_address"),
            "zip": (_pick(r, "zip", "zipcode") or "")[:5] or None,
            "category": _pick(r, "application_type", "permit_type"),
            "pipeline_notes": "somerville_permit",
        })
    return rows


def _fetch_boston_food() -> list[dict]:
    raw: list[dict] = []
    offset = 0
    while True:
        resp = _get_json(BOSTON_CKAN_BASE, {
            "resource_id": BOSTON_FOOD_RESOURCE_ID,
            "limit": BOSTON_FOOD_PAGE_SIZE,
            "offset": offset,
        })
        records = (resp.get("result") or {}).get("records") or []
        if not records:
            break
        raw.extend(records)
        offset += len(records)
        if offset >= BOSTON_FOOD_OFFSET_CEILING:
            break
    rows = []
    for r in raw:
        name = _pick(r, "businessname", "dbaname", "business_name", "dba_name")
        if not name:
            continue
        # Require a phone — a food-license row with no reachable number is
        # essentially dead weight for a sales associate dialing from the CSV.
        phone = _pick(r, "dayphn_cleaned", "dayphn", "phone", "phone_number")
        if not phone:
            continue
        rows.append({
            "source": "boston_food",
            # Restaurants are long-tail Tier C for our ICP, not Tier B.
            "tier": "C",
            "company_name": name,
            "company_phone": phone,
            "address": _pick(r, "address", "licaddr"),
            "zip": (_pick(r, "zip", "licenseezipcode") or "")[:5] or None,
            "category": "food_establishment",
            "pipeline_notes": "boston_food_license",
        })
        if len(rows) >= BOSTON_FOOD_MAX_ROWS:
            break
    return rows


def run_all() -> list[dict]:
    rows: list[dict] = []
    for label, fn in (
        ("cambridge_diversity", _fetch_cambridge_diversity),
        ("somerville_permits", _fetch_somerville_permits),
        ("boston_food", _fetch_boston_food),
    ):
        try:
            r = fn()
            print(f"[city_licenses/{label}] {len(r)} rows")
            rows.extend(r)
        except Exception as e:
            print(f"[city_licenses/{label}] failed: {e}")
    return rows
