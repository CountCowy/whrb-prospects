"""Hunter.io free tier — 25 searches/month.

Reserve strictly for top-priority rows with a domain but no contact email
after website scraping.
"""
from __future__ import annotations

import os

import requests
from dotenv import load_dotenv

load_dotenv()
_KEY = os.getenv("HUNTER_API_KEY")


def domain_search(domain: str) -> dict | None:
    if not _KEY or not domain:
        return None
    try:
        r = requests.get(
            "https://api.hunter.io/v2/domain-search",
            params={"domain": domain, "api_key": _KEY, "limit": 3},
            timeout=20,
        )
        if r.status_code != 200:
            return None
        data = r.json().get("data") or {}
        emails = data.get("emails") or []
        if not emails:
            return None
        top = emails[0]
        return {
            "contact_name": f"{top.get('first_name','')} {top.get('last_name','')}".strip() or None,
            "contact_title": top.get("position"),
            "contact_email": top.get("value"),
            "contact_linkedin": top.get("linkedin"),
        }
    except Exception as e:
        print(f"[hunter] {domain}: {e}")
        return None


def enrich_rows(rows: list[dict], budget: int = 25) -> None:
    spent = 0
    for row in rows:
        if spent >= budget:
            return
        if row.get("contact_email") or not row.get("website"):
            continue
        if row.get("tier") not in ("A", "B"):
            continue
        from urllib.parse import urlparse
        domain = urlparse(row["website"] if row["website"].startswith("http") else "https://" + row["website"]).netloc
        domain = domain.removeprefix("www.")
        if not domain:
            continue
        res = domain_search(domain)
        spent += 1
        if res:
            for k, v in res.items():
                if v and not row.get(k):
                    row[k] = v
            row.setdefault("notes", "")
            row["notes"] += " hunter;"
    print(f"[hunter] used {spent}/{budget}")
