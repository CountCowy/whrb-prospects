"""Dedup rows coming from multiple sources.

Primary key: normalized phone. Fallback: fuzzy name match within same ZIP.
When merging, prefer the row with more non-null fields — but preserve
conflicting non-empty values from the loser under ``alt_<field>`` so a
sales associate can see both candidate emails / websites / addresses.

Fixes for Issue 7 (see CLAUDE.md):
- Conflicting values are stashed under ``alt_<field>`` instead of being
  silently dropped.
- Tier is resolved by taking the *best* tier (A > B > C), independent of
  row completeness.
- Fuzz threshold is raised to 97 when either side has no ZIP (to stop
  unrelated similarly-named businesses in different cities from merging)
  and kept at 92 when both ZIPs match.
- The fuzzy-pass call site now uses ``_merge``'s return value and replaces
  the matched entry in place, so a more-complete ``r`` is not lost when
  it becomes the merge winner.
"""
from __future__ import annotations

import re

from rapidfuzz import fuzz

PHONE_CLEAN = re.compile(r"\D+")

# Fields where a divergent value from the loser should be preserved under
# ``alt_<field>`` rather than discarded. These are the ones a sales associate
# would actually want to see both of when reviewing a merged row.
CONFLICT_PRESERVE_FIELDS = (
    "company_phone",
    "contact_phone",
    "company_email",
    "contact_email",
    "website",
    "address",
    "contact_name",
)

# Tier priority: A beats B beats C. Any unknown value loses to all of them.
TIER_RANK = {"A": 3, "B": 2, "C": 1}


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


def _best_tier(a: str | None, b: str | None) -> str | None:
    ra = TIER_RANK.get((a or "").upper(), 0)
    rb = TIER_RANK.get((b or "").upper(), 0)
    if ra == 0 and rb == 0:
        return a or b
    return a if ra >= rb else b


def _merge(a: dict, b: dict) -> dict:
    winner, loser = (a, b) if _completeness(a) >= _completeness(b) else (b, a)

    # Resolve tier independently of completeness — prospect quality outranks
    # field-count when two records for the same business disagree on tier.
    best_tier = _best_tier(winner.get("tier"), loser.get("tier"))
    if best_tier:
        winner["tier"] = best_tier

    for k, v in loser.items():
        if not v:
            continue
        if k == "tier":
            continue  # already resolved above
        existing = winner.get(k)
        if not existing:
            winner[k] = v
        elif existing != v and k in CONFLICT_PRESERVE_FIELDS:
            # Keep both — stash the loser's value under alt_<field> so the
            # sales associate can evaluate both candidates.
            alt_key = f"alt_{k}"
            if not winner.get(alt_key):
                winner[alt_key] = v

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

    # Fuzzy name+zip pass on the no-phone rows.
    kept: list[dict] = []
    for r in nameless:
        name = _norm_name(r.get("company_name"))
        if not name:
            continue
        zip_ = r.get("zip")
        match: dict | None = None
        match_list: list[dict] | None = None   # which list the match lives in
        match_idx: int | None = None           # and at what index, so we can replace in place
        for idx, existing in enumerate(merged):
            if not _zip_compatible(existing.get("zip"), zip_):
                continue
            if fuzz.ratio(name, _norm_name(existing.get("company_name"))) >= _fuzz_threshold(existing.get("zip"), zip_):
                match = existing
                match_list = merged
                match_idx = idx
                break
        if match is None:
            for idx, existing in enumerate(kept):
                if not _zip_compatible(existing.get("zip"), zip_):
                    continue
                if fuzz.ratio(name, _norm_name(existing.get("company_name"))) >= _fuzz_threshold(existing.get("zip"), zip_):
                    match = existing
                    match_list = kept
                    match_idx = idx
                    break
        if match is not None:
            # Use the return value of _merge — if r is more complete, _merge
            # picks r as the winner and mutates r, so the original match dict
            # is the *loser* and must be replaced in its list.
            assert match_list is not None and match_idx is not None
            merged_row = _merge(match, r)
            match_list[match_idx] = merged_row
        else:
            kept.append(r)

    out = merged + kept
    print(f"[dedupe] {len(rows)} -> {len(out)}")
    return out


def _zip_compatible(a: str | None, b: str | None) -> bool:
    """Two rows can merge if their ZIPs match, OR if at least one is missing.

    We still allow no-ZIP merges (otherwise we lose too many legitimate
    matches), but ``_fuzz_threshold`` raises the name-similarity bar in that
    case.
    """
    if a and b:
        return a == b
    return True


def _fuzz_threshold(a: str | None, b: str | None) -> int:
    """Tighter threshold when ZIP is missing on either side."""
    if a and b and a == b:
        return 92
    return 97
