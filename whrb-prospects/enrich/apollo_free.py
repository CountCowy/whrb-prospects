"""Apollo.io free tier — 100 credits/month. Gives us LinkedIn-backed contact data.

Reserved for Tier A rows with no contact after website+hunter passes.
"""
from __future__ import annotations

import os
from urllib.parse import urlparse

import requests
from dotenv import load_dotenv

load_dotenv()
_KEY = os.getenv("APOLLO_API_KEY")

SEARCH_URL = "https://api.apollo.io/v1/mixed_people/search"

TITLES = [
    "owner", "founder", "president", "ceo", "managing director",
    "marketing director", "marketing manager", "development director",
    "partner", "principal", "general manager",
]


def find_decision_maker(domain: str) -> dict | None:
    if not _KEY or not domain:
        return None
    try:
        r = requests.post(
            SEARCH_URL,
            json={
                "api_key": _KEY,
                "q_organization_domains": domain,
                "person_titles": TITLES,
                "page": 1,
                "per_page": 3,
            },
            timeout=30,
        )
        if r.status_code != 200:
            return None
        people = r.json().get("people") or []
        if not people:
            return None
        p = people[0]
        phones = p.get("phone_numbers") or []
        return {
            "contact_name": p.get("name"),
            "contact_title": p.get("title"),
            "contact_email": p.get("email"),
            "contact_phone": (phones[0] or {}).get("sanitized_number") if phones else None,
            "contact_linkedin": p.get("linkedin_url"),
        }
    except Exception as e:
        print(f"[apollo] {domain}: {e}")
        return None


def enrich_rows(rows: list[dict], budget: int = 100) -> None:
    spent = 0
    # Prioritize Tier A rows with no contact info yet
    candidates = [
        r for r in rows
        if r.get("tier") == "A"
        and r.get("website")
        and not r.get("contact_name")
    ]
    for row in candidates:
        if spent >= budget:
            break
        url = row["website"]
        domain = urlparse(url if url.startswith("http") else "https://" + url).netloc.removeprefix("www.")
        if not domain:
            continue
        res = find_decision_maker(domain)
        spent += 1
        if res:
            for k, v in res.items():
                if v and not row.get(k):
                    row[k] = v
            row.setdefault("pipeline_notes", "")
            row["pipeline_notes"] += " apollo;"
    print(f"[apollo] used {spent}/{budget}")
