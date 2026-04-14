"""Dedup rows coming from multiple sources.

Primary key: normalized phone. Fallback: fuzzy name match within same ZIP.
When merging, prefer the row with more non-null fields.
"""
from __future__ import annotations

import re

from rapidfuzz import fuzz

PHONE_CLEAN = re.compile(r"\D+")


def _norm_name(s: str | None) -> str:
    if not s:
        return ""
    s = re.sub(r"[^\w\s]", "", s.lower())
    return re.sub(r"\s+", " ", s).strip()


def _norm_phone(s: str | None) -> str:
    if not s:
        return ""
    return PHONE_CLEAN.sub("", s)[-10:]


def _completeness(row: dict) -> int:
    return sum(1 for v in row.values() if v)


def _merge(a: dict, b: dict) -> dict:
    winner, loser = (a, b) if _completeness(a) >= _completeness(b) else (b, a)
    for k, v in loser.items():
        if v and not winner.get(k):
            winner[k] = v
    srcs = {winner.get("source"), loser.get("source")}
    winner["source"] = ",".join(sorted(s for s in srcs if s))
    return winner


def dedupe(rows: list[dict]) -> list[dict]:
    by_phone: dict[str, dict] = {}
    nameless: list[dict] = []
    for r in rows:
        phone = _norm_phone(r.get("company_phone") or r.get("contact_phone"))
        if phone and len(phone) == 10:
            if phone in by_phone:
                by_phone[phone] = _merge(by_phone[phone], r)
            else:
                by_phone[phone] = r
        else:
            nameless.append(r)

    merged = list(by_phone.values())

    # Fuzzy name+zip pass on the no-phone rows
    kept: list[dict] = []
    for r in nameless:
        name = _norm_name(r.get("company_name"))
        if not name:
            continue
        zip_ = r.get("zip")
        match = None
        for existing in merged + kept:
            if existing.get("zip") and zip_ and existing["zip"] != zip_:
                continue
            if fuzz.ratio(name, _norm_name(existing.get("company_name"))) >= 92:
                match = existing
                break
        if match:
            _merge(match, r)
        else:
            kept.append(r)

    out = merged + kept
    print(f"[dedupe] {len(rows)} -> {len(out)}")
    return out
