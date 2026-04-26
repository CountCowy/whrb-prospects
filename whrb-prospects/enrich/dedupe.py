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

Stage T2 additions:
- ``_merge_tags`` unions the ``tags`` dicts that source emitters now attach
  to every row. Union is per-(axis, value) pair so a BSO sponsor also
  picked up by OSM keeps both ``genre:classical`` and ``sector:hospitality``
  where applicable. See plan §4.4 / §4.5.
- Compliance axis is strict ("any wins") — any row carrying
  ``compliance:political`` wins that value for the merged row even when
  the other side is empty.

Stage T4 additions:
- Every successful ``_merge`` emits a ``dedupe_match`` event_log row
  carrying ``{winning_source, losing_source, business_key}``. The web
  app's /admin/sources duplicate-rate metric counts these. Pre-T4 merges
  were synthesized into the same shape via the migration backfill in
  011_instrumentation.sql.
"""
from __future__ import annotations

import re
from typing import Any

from rapidfuzz import fuzz

# Optional import — pipeline-side runs always have it, but the unit test
# suite imports `enrich.dedupe` without the broader project context. Type
# as `Any` so mypy accepts the None fallback (the strict typed module
# inference would otherwise reject the reassignment).
_event_log: Any
try:
    from util import event_log as _event_log_mod
    _event_log = _event_log_mod
except Exception:
    _event_log = None

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


def _merge_tags(
    a: dict[str, list[str]] | None,
    b: dict[str, list[str]] | None,
) -> dict[str, list[str]]:
    """Union two ``{axis: [values]}`` emitter dicts.

    Semantics:
      * Per-axis **union** — pipeline-emitted rows never conflict; two
        sources can both emit ``sector:arts`` and the merged row carries
        one copy.
      * **Compliance is additive-and-sticky**: any value present on
        either side is kept. This is the "any wins" clause from plan
        §4.5 — we never silently drop a political / alcohol / gambling
        tag because the other row didn't emit one.
      * Values within each axis are returned in sorted order to give
        the CSV export a deterministic diff.
    """
    out: dict[str, list[str]] = {}
    for side in (a or {}, b or {}):
        for axis, values in side.items():
            if not values:
                continue
            bucket = out.setdefault(axis, [])
            for v in values:
                if v and v not in bucket:
                    bucket.append(v)
    # Sort every axis for determinism.
    return {axis: sorted(values) for axis, values in out.items() if values}


def _merge(a: dict, b: dict) -> dict:
    winner, loser = (a, b) if _completeness(a) >= _completeness(b) else (b, a)

    # Resolve tier independently of completeness — prospect quality outranks
    # field-count when two records for the same business disagree on tier.
    best_tier = _best_tier(winner.get("tier"), loser.get("tier"))
    if best_tier:
        winner["tier"] = best_tier

    # Union tags across the pair before the for-loop below blindly copies
    # loser fields (which would only capture `tags` when winner['tags'] is
    # falsy, losing the overlap).
    merged_tags = _merge_tags(winner.get("tags"), loser.get("tags"))
    if merged_tags:
        winner["tags"] = merged_tags

    for k, v in loser.items():
        if not v:
            continue
        if k == "tier":
            continue  # already resolved above
        if k == "tags":
            continue  # already unioned above
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

    # T4: emit dedupe_match event for source-quality instrumentation. The
    # winner_src here is conventional (the more-complete row's source);
    # the loser_src is the other contributor. Fire-and-forget — never let
    # a logging failure break a merge.
    if _event_log is not None:
        try:
            winner_src = winner.get("source") or ""
            loser_src = loser.get("source") or ""
            # Pick the actual losing-source contribution from the loser
            # row's source comma-list (if it accumulated any). Fall back
            # to the loser's raw source verbatim.
            loser_first = (
                next(
                    (s for s in loser_src.split(",") if s and s != winner_src),
                    loser_src,
                )
                if loser_src
                else None
            )
            _event_log.info(
                "dedupe_match",
                f"merged {loser_src or '?'} into {winner_src or '?'}",
                context={
                    "winning_source": winner_src,
                    "losing_source": loser_first or loser_src or "",
                    "business_key": winner.get("business_key")
                    or winner.get("company_phone")
                    or winner.get("company_name"),
                },
            )
        except Exception:
            pass

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
