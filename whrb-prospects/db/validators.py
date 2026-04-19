"""Row-level validators invoked by the Supabase sync phase.

These helpers normalize and sanity-check scraped values *before* the row is
upserted. Invalid values return ``None`` (the column becomes SQL ``NULL``) and
emit a ``warn`` event on ``event_log`` so the Stage-4 style integrity checks
can diff the `validation_warnings` count over time.

Call sites live in :mod:`db.supabase_sync` (``_build_insert`` and
``_patch_existing``). Keep them pure: no network, no DB, no state.
"""
from __future__ import annotations

import re

from config import PHONE_DIGIT_COUNT
from util import event_log

# IRS EINs are always NN-NNNNNNN once formatted.
EIN_PATTERN = re.compile(r"^\d{2}-\d{7}$")
_PHONE_NON_DIGITS = re.compile(r"\D+")


def validate_ein(value: object, *, business_key: str | None = None) -> str | None:
    """Return ``value`` unchanged if it matches ``NN-NNNNNNN``, else ``None``.

    ``None``/empty input is passed through as ``None`` (no warning — absent
    is not the same as malformed). Anything else logs ``ein_invalid`` at
    ``warn`` level and returns ``None``.
    """
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    if EIN_PATTERN.match(text):
        return text
    event_log.warn(
        "ein_invalid",
        f"rejected malformed EIN: {text!r}",
        context={"ein": text, "business_key": business_key},
    )
    return None


def validate_phone(value: object, *, business_key: str | None = None) -> str | None:
    """Return the input phone unchanged if it contains ≥10 digits, else ``None``.

    Stored form is intentionally *preserved* (e.g. ``(617) 495-3400``) — the
    UI reads the human-friendly version and the 10-digit normalized form
    already lives inside the stable ``business_key``. Inputs that strip down
    to fewer than :data:`config.PHONE_DIGIT_COUNT` digits are rejected as
    malformed.
    """
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    digits = _PHONE_NON_DIGITS.sub("", text)
    if len(digits) >= PHONE_DIGIT_COUNT:
        return text
    event_log.warn(
        "phone_invalid",
        f"rejected malformed phone: {text!r}",
        context={"phone": text, "business_key": business_key},
    )
    return None
