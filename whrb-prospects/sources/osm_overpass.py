"""OpenStreetMap Overpass API — primary free replacement for Google Places.

No API key, no billing, no rate limit beyond reasonable courtesy.
Docs: https://wiki.openstreetmap.org/wiki/Overpass_API
"""
from __future__ import annotations

import time
from collections.abc import Iterable

import requests

from config import OSM_QUERIES, WHRB_BBOX
from util.http import raise_for_smart_status, smart_retry
from util.tags import (
    affiliation_for_zip,
    build_tag_set,
    osm_category_to_tags,
)

OVERPASS_URL = "https://overpass-api.de/api/interpreter"

# Overpass actively blocks generic User-Agent strings (`python-requests/*`,
# `Mozilla/5.0...` browser-style) with HTTP 406 — confirmed empirically
# during run deebeff6 incident review. A descriptive, identifying UA
# (their published etiquette: include a contact URL or email) is required
# instead. The `+https://...` syntax matches the convention used by major
# crawlers' robots-of-record entries.
_OVERPASS_UA = (
    "WHRBProspectPipeline/1.0 "
    "(+https://www.whrb.org/sales; sales@whrb.org)"
)
_OVERPASS_HEADERS = {"User-Agent": _OVERPASS_UA}


def _build_query(tag_filters: Iterable[str], bbox: tuple) -> str:
    s, w, n, e = bbox[0], bbox[1], bbox[2], bbox[3]
    parts = []
    for f in tag_filters:
        parts.append(f'node[{f}]({s},{w},{n},{e});')
        parts.append(f'way[{f}]({s},{w},{n},{e});')
    return f"[out:json][timeout:60];({''.join(parts)});out center tags;"


@smart_retry(wait_min=5, wait_max=60)
def _post(query: str) -> dict:
    r = requests.post(
        OVERPASS_URL,
        data={"data": query},
        headers=_OVERPASS_HEADERS,
        timeout=120,
    )
    raise_for_smart_status(r)
    return r.json()


def fetch_tier(tier: str) -> list[dict]:
    """Fetch every OSM element for a WHRB tier. Returns normalized dicts."""
    query = _build_query(OSM_QUERIES[tier], WHRB_BBOX)
    data = _post(query)
    rows = []
    for el in data.get("elements", []):
        tags = el.get("tags", {})
        name = tags.get("name")
        if not name:
            continue
        category = _first_category(tags)
        zip_ = (tags.get("addr:postcode") or "")[:5] or None
        sector, operating_model = osm_category_to_tags(category)
        affiliation = affiliation_for_zip(zip_)
        row_tags = build_tag_set(
            sector=sector,
            operating_model=operating_model,
            affiliation=affiliation,
            source="osm",
        )
        rows.append({
            "source": "osm",
            "tier": tier,
            "company_name": name,
            "website": tags.get("website") or tags.get("contact:website"),
            "company_phone": tags.get("phone") or tags.get("contact:phone"),
            "company_email": tags.get("email") or tags.get("contact:email"),
            "address": _compose_address(tags),
            "zip": zip_,
            "category": category,
            "lat": el.get("lat") or (el.get("center") or {}).get("lat"),
            "lon": el.get("lon") or (el.get("center") or {}).get("lon"),
            "tags": row_tags,
        })
    return rows


def _compose_address(tags: dict) -> str | None:
    parts = [
        tags.get("addr:housenumber"), tags.get("addr:street"),
        tags.get("addr:city"), tags.get("addr:state"),
        tags.get("addr:postcode"),
    ]
    parts = [p for p in parts if p]
    return ", ".join(parts) if parts else None


def _first_category(tags: dict) -> str | None:
    for k in ("amenity", "shop", "office", "craft", "tourism", "leisure"):
        if k in tags:
            return f"{k}={tags[k]}"
    return None


def run_all() -> list[dict]:
    all_rows: list[dict] = []
    for tier in ("A", "B", "C"):
        print(f"[osm] fetching tier {tier}...")
        all_rows.extend(fetch_tier(tier))
        time.sleep(5)  # be nice to the public Overpass instance
    print(f"[osm] total rows: {len(all_rows)}")
    return all_rows


if __name__ == "__main__":
    import json
    print(json.dumps(run_all()[:5], indent=2))
