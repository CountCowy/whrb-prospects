"""Direct website scraping — the primary FREE enrichment path.

For any company with a website, fetch /, /contact, /about, /team and extract:
- emails (regex, filter obvious junk)
- owner/manager names (common label heuristics)
- phone numbers

This closes most of the gap left by capped paid enrichment tiers.
"""
from __future__ import annotations

import re
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup
from tenacity import retry, stop_after_attempt, wait_exponential

UA = "Mozilla/5.0 (whrb-prospects research crawler)"
EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
PHONE_RE = re.compile(r"\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b")
NAME_LABEL_RE = re.compile(
    r"(?:owner|founder|president|ceo|proprietor|manager|director)[:\s]+"
    r"([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})",
    re.IGNORECASE,
)

PATHS = ["", "/contact", "/contact-us", "/about", "/about-us", "/team", "/staff"]
JUNK_EMAIL_PREFIXES = ("noreply", "no-reply", "wordpress", "example")


@retry(stop=stop_after_attempt(2), wait=wait_exponential(min=2, max=15))
def _get(url: str) -> str | None:
    try:
        r = requests.get(url, headers={"User-Agent": UA}, timeout=15)
        if r.status_code == 200 and "text/html" in r.headers.get("content-type", ""):
            return r.text
    except Exception:
        return None
    return None


def _classify_email(email: str) -> str:
    local = email.split("@", 1)[0].lower()
    if any(local.startswith(p) for p in JUNK_EMAIL_PREFIXES):
        return "junk"
    if local in ("sales", "marketing", "advertising", "ads", "partnerships", "sponsor"):
        return "sales"
    if local in ("info", "hello", "contact", "office", "hi"):
        return "company"
    return "personal"


def scrape_site(url: str) -> dict:
    """Return {company_email, sales_email, contact_name, contact_email, contact_phone}."""
    out: dict = {}
    if not url:
        return out
    parsed = urlparse(url if url.startswith("http") else "https://" + url)
    base = f"{parsed.scheme}://{parsed.netloc}"
    domain = parsed.netloc.lower().removeprefix("www.")

    found_emails: set[str] = set()
    found_phones: set[str] = set()
    candidate_name: str | None = None

    for path in PATHS:
        html = _get(urljoin(base, path))
        if not html:
            continue
        # Emails
        for m in EMAIL_RE.findall(html):
            if domain in m.lower() or not re.search(r"(gmail|yahoo|hotmail|outlook)", m.lower()):
                found_emails.add(m.lower())
        # Phones
        for m in PHONE_RE.findall(html):
            found_phones.add(m)
        # Names
        if not candidate_name:
            text = BeautifulSoup(html, "lxml").get_text(" ", strip=True)
            m = NAME_LABEL_RE.search(text)
            if m:
                candidate_name = m.group(1)

    # Classify emails
    sales, company, personal = None, None, None
    for e in found_emails:
        kind = _classify_email(e)
        if kind == "sales" and not sales:
            sales = e
        elif kind == "company" and not company:
            company = e
        elif kind == "personal" and not personal:
            personal = e

    out["company_email"] = company or (sales or personal)
    out["sales_email"] = sales
    out["contact_email"] = personal
    out["contact_name"] = candidate_name
    if found_phones:
        out["contact_phone"] = next(iter(found_phones))
    return out


def enrich_rows(rows: list[dict]) -> None:
    for i, row in enumerate(rows):
        if not row.get("website"):
            continue
        if row.get("contact_email") or row.get("company_email"):
            continue
        data = scrape_site(row["website"])
        for k, v in data.items():
            if v and not row.get(k):
                row[k] = v
        if (i + 1) % 50 == 0:
            print(f"[contact_scraper] {i + 1}/{len(rows)}")
