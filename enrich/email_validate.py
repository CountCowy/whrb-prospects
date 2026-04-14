"""Free email validation — syntax via email-validator + DNS MX lookup."""
from __future__ import annotations

import dns.resolver
from email_validator import EmailNotValidError, validate_email

_MX_CACHE: dict[str, bool] = {}


def _has_mx(domain: str) -> bool:
    if domain in _MX_CACHE:
        return _MX_CACHE[domain]
    try:
        answers = dns.resolver.resolve(domain, "MX", lifetime=5)
        ok = len(list(answers)) > 0
    except Exception:
        ok = False
    _MX_CACHE[domain] = ok
    return ok


def is_valid(email: str | None) -> bool:
    if not email:
        return False
    try:
        v = validate_email(email, check_deliverability=False)
        return _has_mx(v.domain)
    except EmailNotValidError:
        return False


def clean_rows(rows: list[dict]) -> None:
    for row in rows:
        for field in ("company_email", "sales_email", "contact_email"):
            if row.get(field) and not is_valid(row[field]):
                row[field] = None
