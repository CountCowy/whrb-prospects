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

# 10-digit "phones" we know are never real — common when scrapers grab a
# numeric run from a JS variable, schema.org placeholder, or copy-paste
# template. ``2147483647`` is INT_MAX (32-bit signed) and showed up across
# four unrelated companies in run ae03c435/deebeff6 because the area code
# (``214``) is a real NANP code (Dallas), so ``VALID_NANP_AREA_CODES``
# alone can't catch it. Most repdigit + monotonic-ramp entries are
# *also* caught by the NPA gate (NPA 000, 111, 222, 333, 444, 555, 666,
# 777, 999, 012, 123, 987, 098 are not assigned), but we keep them in
# this set as a documented denylist so a future NPA-list addition can't
# silently reintroduce the regression. The non-redundant entries — the
# ones the NPA gate alone would let through — are tagged below.
# Defense-in-depth: ``business_key``, ``validate_phone``, and
# ``contact_scraper`` all consult this set so a sentinel can never
# become a stable identity.
PHONE_SENTINELS: frozenset[str] = frozenset({
    # Repdigit runs (10) — built programmatically.
    *(d * 10 for d in "0123456789"),
    # Monotonic ramps — common placeholder values.
    "1234567890",   # ascending
    "0123456789",   # ascending with leading 0
    "9876543210",   # descending
    "0987654321",   # descending with leading 0
    # INT_MAX (32-bit signed) and its immediate ±1 neighbors. NPA 214
    # is real (Dallas), so these are the entries the NPA gate alone
    # cannot catch. ``2147483647`` was the canonical run-deebeff6
    # offender; ±1 covers off-by-one variants from JS-int casts.
    "2147483647",
    "2147483646",
    "2147483648",
})

# Currently-assigned NANP area codes (US + Canada + Caribbean NANP members) plus
# common toll-free prefixes. Used to reject scraper-hallucinated phones whose
# 10-digit form starts with an impossible NPA (e.g. 114, 177, 527 — the bug
# behind the Reagle Music Theater duplicate cluster). Source: NANPA published
# active-NPA list. This is a slow-moving list — bump when a new NPA goes live.
VALID_NANP_AREA_CODES: frozenset[str] = frozenset({
    # Toll-free (shared NANP)
    "800", "833", "844", "855", "866", "877", "888",
    # United States (50 states + DC + territories) — geographic NPAs
    "201", "202", "203", "205", "206", "207", "208", "209", "210", "212",
    "213", "214", "215", "216", "217", "218", "219", "220", "223", "224",
    "225", "227", "228", "229", "231", "234", "235", "239", "240", "248",
    "251", "252", "253", "254", "256", "257", "260", "262", "267", "269",
    "270", "272", "274", "276", "279", "281", "283", "301", "302", "303",
    "304", "305", "307", "308", "309", "310", "312", "313", "314", "315",
    "316", "317", "318", "319", "320", "321", "323", "325", "326", "327",
    "330", "331", "332", "334", "336", "337", "339", "346", "347", "350",
    "351", "352", "360", "361", "363", "364", "369", "380", "385", "386",
    "401", "402", "404", "405", "406", "407", "408", "409", "410", "412",
    "413", "414", "415", "417", "419", "423", "424", "425", "430", "432",
    "434", "435", "440", "442", "443", "447", "448", "458", "463", "464",
    "469", "470", "472", "475", "478", "479", "480", "484", "501", "502",
    "503", "504", "505", "507", "508", "509", "510", "512", "513", "515",
    "516", "517", "518", "520", "530", "531", "534", "539", "540", "541",
    "551", "557", "559", "561", "562", "563", "564", "567", "570", "571",
    "572", "573", "574", "575", "580", "582", "585", "586", "601", "602",
    "603", "605", "606", "607", "608", "609", "610", "612", "614", "615",
    "616", "617", "618", "619", "620", "623", "626", "628", "629", "630",
    "631", "636", "640", "641", "645", "646", "650", "651", "656", "657",
    "660", "661", "662", "667", "669", "678", "679", "680", "681", "682",
    "689", "701", "702", "703", "704", "706", "707", "708", "712", "713",
    "714", "715", "716", "717", "718", "719", "720", "724", "725", "726",
    "727", "728", "730", "731", "732", "734", "737", "740", "743", "747",
    "754", "757", "760", "762", "763", "764", "765", "769", "770", "771",
    "772", "773", "774", "775", "779", "781", "785", "786", "801", "802",
    "803", "804", "805", "806", "808", "810", "812", "813", "814", "815",
    "816", "817", "818", "820", "828", "830", "831", "832", "835", "838",
    "839", "840", "843", "845", "847", "848", "850", "854", "856", "857",
    "858", "859", "860", "861", "862", "863", "864", "865", "870", "872",
    "878", "901", "903", "904", "906", "907", "908", "909", "910", "912",
    "913", "914", "915", "916", "917", "918", "919", "920", "925", "928",
    "929", "930", "931", "934", "936", "937", "938", "940", "941",
    "943", "945", "947", "948", "949", "951", "952", "954", "956", "959",
    "970", "971", "972", "973", "975", "978", "979", "980", "983", "984",
    "985", "986", "989",
    # US territories (Caribbean / Pacific NANP)
    "340",  # US Virgin Islands
    "670",  # Northern Mariana Islands
    "671",  # Guam
    "684",  # American Samoa
    "787", "939",  # Puerto Rico
    # Canada — geographic NPAs
    "204", "226", "236", "249", "250", "263", "289", "306", "343", "354",
    "365", "367", "368", "382", "387", "403", "416", "418", "428", "431",
    "437", "438", "450", "468", "474", "506", "514", "519", "548", "568",
    "579", "581", "584", "587", "604", "613", "639", "647", "672", "683",
    "705", "709", "742", "753", "778", "780", "782", "819", "825", "867",
    "873", "879", "902", "905", "942",
    # Caribbean NANP members
    "242",  # Bahamas
    "246",  # Barbados
    "264",  # Anguilla
    "268",  # Antigua and Barbuda
    "284",  # British Virgin Islands
    "345",  # Cayman Islands
    "441",  # Bermuda
    "473",  # Grenada
    "649",  # Turks and Caicos
    "658", "876",  # Jamaica
    "664",  # Montserrat
    "721",  # Sint Maarten
    "758",  # St. Lucia
    "767",  # Dominica
    "784",  # St. Vincent and the Grenadines
    "809", "829", "849",  # Dominican Republic
    "868",  # Trinidad and Tobago
    "869",  # St. Kitts and Nevis
})


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
    """Return the input phone unchanged if it contains ≥10 digits AND a valid
    NANP area code, else ``None``.

    Stored form is intentionally *preserved* (e.g. ``(617) 495-3400``) — the
    UI reads the human-friendly version and the 10-digit normalized form
    already lives inside the stable ``business_key``. Two rejection paths:

    * Inputs that strip down to fewer than :data:`config.PHONE_DIGIT_COUNT`
      digits log ``phone_invalid``.
    * Inputs whose 3-digit area code (last 10 digits, first 3) isn't in
      :data:`VALID_NANP_AREA_CODES` log ``phone_nanp_invalid``. This catches
      scraper hallucinations like 114-, 177-, 527- prefixes where a regex
      grabbed a random 10-digit substring off a page.
    """
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    digits = _PHONE_NON_DIGITS.sub("", text)
    if len(digits) < PHONE_DIGIT_COUNT:
        event_log.warn(
            "phone_invalid",
            f"rejected malformed phone: {text!r}",
            context={"phone": text, "business_key": business_key},
        )
        return None
    last10 = digits[-10:]
    if last10 in PHONE_SENTINELS:
        event_log.warn(
            "phone_sentinel_rejected",
            f"rejected sentinel phone {last10!r}: {text!r}",
            context={"phone": text, "business_key": business_key},
        )
        return None
    area = last10[:3]
    if area not in VALID_NANP_AREA_CODES:
        event_log.warn(
            "phone_nanp_invalid",
            f"rejected phone with invalid NANP area code {area!r}: {text!r}",
            context={"phone": text, "area_code": area, "business_key": business_key},
        )
        return None
    return text
