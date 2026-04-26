"""Direct website scraping — the primary FREE enrichment path (async).

For each company with a website, fetch /, /contact, /about and extract:
- emails (regex, filter obvious junk)
- owner/manager names (common label heuristics)
- phone numbers

Per-row work is serial across PATHS (polite to small hosts), but rows run
concurrently up to MAX_CONCURRENT_ROWS. Sync wrapper `enrich_rows(rows)`
preserves the old public signature.
"""
from __future__ import annotations

import asyncio
import re
from urllib.parse import urljoin, urlparse

import httpx
from bs4 import BeautifulSoup

from util.normalize import normalize_website

UA = "Mozilla/5.0 (whrb-prospects research crawler)"
EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
PHONE_RE = re.compile(r"\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b")
NAME_LABEL_RE = re.compile(
    r"(?:owner|founder|president|ceo|proprietor|manager|director)[:\s]+"
    r"([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})",
    re.IGNORECASE,
)

PATHS = ["", "/contact", "/about"]
JUNK_EMAIL_PREFIXES = ("noreply", "no-reply", "wordpress", "example")

TIMEOUT = httpx.Timeout(connect=5.0, read=8.0, write=5.0, pool=5.0)
MAX_CONCURRENT_ROWS = 40


def _classify_email(email: str) -> str:
    local = email.split("@", 1)[0].lower()
    if any(local.startswith(p) for p in JUNK_EMAIL_PREFIXES):
        return "junk"
    if local in ("sales", "marketing", "advertising", "ads", "partnerships", "sponsor"):
        return "sales"
    if local in ("info", "hello", "contact", "office", "hi"):
        return "company"
    return "personal"


async def _fetch(client: httpx.AsyncClient, url: str) -> str | None:
    try:
        r = await client.get(url, headers={"User-Agent": UA})
    except (httpx.HTTPError, httpx.TimeoutException):
        return None
    if r.status_code != 200:
        return None
    if "text/html" not in r.headers.get("content-type", ""):
        return None
    return r.text


def _extract(html: str, domain: str, state: dict) -> None:
    found_emails: set[str] = state["emails"]
    for m in EMAIL_RE.findall(html):
        low = m.lower()
        if domain in low or not re.search(r"(gmail|yahoo|hotmail|outlook)", low):
            found_emails.add(low)
    for m in PHONE_RE.findall(html):
        state["phones"].add(m)
    if not state["name"]:
        text = BeautifulSoup(html, "lxml").get_text(" ", strip=True)
        m = NAME_LABEL_RE.search(text)
        if m:
            state["name"] = m.group(1)


def _has_usable_email(emails: set[str]) -> bool:
    for e in emails:
        if _classify_email(e) in ("personal", "company", "sales"):
            return True
    return False


def _finalize(state: dict) -> dict:
    emails = state["emails"]
    sales = company = personal = None
    for e in emails:
        kind = _classify_email(e)
        if kind == "sales" and not sales:
            sales = e
        elif kind == "company" and not company:
            company = e
        elif kind == "personal" and not personal:
            personal = e
    out: dict = {
        "company_email": company or (sales or personal),
        "sales_email": sales,
        "contact_email": personal,
        "contact_name": state["name"],
    }
    if state["phones"]:
        out["contact_phone"] = next(iter(state["phones"]))
    return out


async def _scrape_site(
    client: httpx.AsyncClient,
    sem: asyncio.Semaphore,
    url,
) -> dict:
    url = normalize_website(url)
    if not url:
        return {}
    parsed = urlparse(url if url.startswith("http") else "https://" + url)
    if not parsed.netloc:
        return {}
    base = f"{parsed.scheme}://{parsed.netloc}"
    domain = parsed.netloc.lower().removeprefix("www.")

    state = {"emails": set(), "phones": set(), "name": None}

    async with sem:
        for path in PATHS:
            html = await _fetch(client, urljoin(base, path))
            if not html:
                continue
            _extract(html, domain, state)
            if _has_usable_email(state["emails"]):
                break
    return _finalize(state)


async def _enrich_async(rows: list[dict]) -> None:
    sem = asyncio.Semaphore(MAX_CONCURRENT_ROWS)
    async with httpx.AsyncClient(
        timeout=TIMEOUT,
        follow_redirects=True,
        limits=httpx.Limits(
            max_connections=MAX_CONCURRENT_ROWS + 20,
            max_keepalive_connections=MAX_CONCURRENT_ROWS,
        ),
    ) as client:
        indices: list[int] = []
        coros = []
        for i, row in enumerate(rows):
            if not row.get("website"):
                continue
            if row.get("contact_email") or row.get("company_email"):
                continue
            indices.append(i)
            coros.append(_scrape_site(client, sem, row["website"]))

        total = len(coros)
        if not total:
            return
        print(f"[contact_scraper] scraping {total} sites async")
        done = 0
        # Process in chunks to emit progress without blocking the loop.
        CHUNK = 200
        for start in range(0, total, CHUNK):
            end = min(start + CHUNK, total)
            results = await asyncio.gather(*coros[start:end], return_exceptions=True)
            for idx, res in zip(indices[start:end], results):
                if isinstance(res, Exception) or not res:
                    continue
                row = rows[idx]
                sets_contact_email = (
                    bool(res.get("contact_email"))
                    and not row.get("contact_email")
                )
                for k, v in res.items():
                    if v and not row.get(k):
                        row[k] = v
                if sets_contact_email:
                    row["_contact_email_source"] = "pipeline_scraper"
            done = end
            print(f"[contact_scraper] {done}/{total}")


def enrich_rows(rows: list[dict]) -> None:
    """Sync wrapper — preserves the public signature used by pipeline.main()."""
    asyncio.run(_enrich_async(rows))
