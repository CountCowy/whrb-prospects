"""Yelp Fusion API — free tier, 500 calls/day, no billing."""
from __future__ import annotations

import os

from dotenv import load_dotenv
from yelpapi import YelpAPI

from config import MIN_RATING, MIN_REVIEW_COUNT, YELP_SEARCHES
from util.http import smart_retry

load_dotenv()
_KEY = os.getenv("YELP_API_KEY")


def _client() -> YelpAPI | None:
    if not _KEY:
        print("[yelp] YELP_API_KEY missing; skipping")
        return None
    return YelpAPI(_KEY)


@smart_retry()
def _search(yelp: YelpAPI, term: str, location: str, offset: int) -> dict:
    return yelp.search_query(term=term, location=location, limit=50, offset=offset)


def run_all() -> list[dict]:
    yelp = _client()
    if yelp is None:
        return []
    rows: list[dict] = []
    for term, location in YELP_SEARCHES:
        print(f"[yelp] {term} in {location}")
        offset = 0
        # Yelp hard-caps offset + limit at 240; with limit=50 the last legal offset is 190
        while offset <= 190:
            try:
                data = _search(yelp, term, location, offset)
            except Exception as e:
                print(f"[yelp] {term}@{offset} failed: {e}")
                break
            biz = data.get("businesses", [])
            if not biz:
                break
            for b in biz:
                if b.get("rating", 0) < MIN_RATING:
                    continue
                if b.get("review_count", 0) < MIN_REVIEW_COUNT:
                    continue
                loc = b.get("location") or {}
                rows.append({
                    "source": "yelp",
                    "tier": "C",
                    "company_name": b.get("name"),
                    "website": b.get("url"),  # Yelp listing; real site scraped later
                    "company_phone": b.get("display_phone"),
                    "company_email": None,
                    "address": ", ".join(loc.get("display_address") or []),
                    "zip": loc.get("zip_code"),
                    "category": (b.get("categories") or [{}])[0].get("alias"),
                    "rating": b.get("rating"),
                    "review_count": b.get("review_count"),
                })
            offset += 50
    print(f"[yelp] total rows: {len(rows)}")
    return rows


if __name__ == "__main__":
    print(len(run_all()))
