"""Shared configuration: ZIPs, categories, thresholds."""

# WHRB 95.3 signal area — three concentric rings per the 2025 media kit.
#
# - Local ring: Cambridge / Somerville / Brookline / Boston core / inner suburbs.
#   (The original WHRB_ZIPS list, unchanged.)
# - Distant ring: outer suburbs out to ~25 miles where the signal is reliable
#   in cars and indoors with a decent receiver. Added in Stage T1
#   (gleaming-dawn §1.3 #19) to widen scraper coverage to the full Distant ring.
# - Fringe ring (Manchester NH, Hartford, Providence) is intentionally NOT
#   added to WHRB_ZIPS — it surfaces only via the `affiliation:new_england_regional`
#   tag in T2+, never as a geographic filter.
WHRB_ZIPS = [
    # --- Local ring (unchanged) ----------------------------------------
    # Cambridge
    "02138", "02139", "02140", "02141", "02142",
    # Somerville
    "02143", "02144", "02145",
    # Brookline
    "02445", "02446",
    # Boston core (Back Bay, South End, Fenway, JP, Allston/Brighton)
    "02115", "02116", "02118", "02130", "02134", "02135", "02215",
    # Belmont / Watertown / Arlington
    "02472", "02474", "02476", "02478",
    # --- Distant ring (new in Stage T1) --------------------------------
    # North Shore inner suburbs
    "01970",  # Salem
    "01960",  # Peabody
    "01901",  # Lynn
    "02151",  # Revere
    "02150",  # Chelsea
    "02149",  # Everett
    "02148",  # Malden
    "02155",  # Medford
    "02176",  # Melrose
    "01890",  # Winchester
]

# Bounding box covering the WHRB ZIP list (min_lat, min_lon, max_lat, max_lon).
# Widened in Stage T1 to include the Distant ring north-shore inner suburbs
# (Salem 42.52, Peabody 42.53, Lynn 42.46, Winchester 42.45). Western and
# southern bounds unchanged.
WHRB_BBOX = (42.3200, -71.1700, 42.5500, -70.8500)

# Tier A — anchor sponsors (arts, institutions, premium retail)
# Tier B — mid-market independents (restaurants, boutiques, professional services)
# Tier C — micro-local home services

# OSM Overpass tag queries per tier
OSM_QUERIES = {
    "A": [
        '"amenity"="theatre"', '"amenity"="arts_centre"',
        '"tourism"="museum"', '"amenity"="concert_hall"',
        '"shop"="art"', '"shop"="musical_instrument"',
    ],
    "B": [
        '"amenity"="restaurant"', '"amenity"="cafe"', '"amenity"="bar"',
        '"amenity"="pub"', '"amenity"="ice_cream"',
        '"shop"="books"', '"shop"="jewelry"', '"shop"="clothes"',
        '"shop"="wine"', '"shop"="bakery"', '"shop"="butcher"',
        '"amenity"="dentist"', '"amenity"="doctors"',
        '"amenity"="veterinary"', '"office"="lawyer"',
        '"office"="accountant"', '"office"="estate_agent"',
        '"leisure"="fitness_centre"', '"shop"="optician"',
    ],
    "C": [
        '"craft"="plumber"', '"craft"="electrician"',
        '"craft"="hvac"', '"craft"="painter"',
        '"craft"="carpenter"', '"craft"="gardener"',
        '"craft"="roofer"', '"shop"="garden_centre"',
    ],
}

# Yelp search terms — used where OSM coverage is weak
YELP_SEARCHES = [
    ("landscaping", "Cambridge, MA"),
    ("lawn care", "Somerville, MA"),
    ("tree service", "Brookline, MA"),
    ("snow removal", "Cambridge, MA"),
    ("hvac", "Cambridge, MA"),
    ("house painter", "Somerville, MA"),
    ("handyman", "Brookline, MA"),
    ("cleaning service", "Cambridge, MA"),
    ("dog walker", "Cambridge, MA"),
    ("piano tuner", "Boston, MA"),
    ("tutor", "Cambridge, MA"),
    ("tax preparer", "Somerville, MA"),
    ("mover", "Cambridge, MA"),
    ("pest control", "Cambridge, MA"),
    ("dog trainer", "Cambridge, MA"),
]

# Quality filters
MIN_REVIEW_COUNT = 15
MIN_RATING = 3.8

# Priority scoring weights
SCORE_WEIGHTS = {
    "has_website": 20,
    "has_phone": 10,
    "has_contact_name": 25,
    "in_chamber": 15,
    "review_count_log": 10,
    "tier_A": 30,
    "tier_B": 15,
    "tier_C": 5,
}

# ---------------------------------------------------------------------------
# Operational constants
#
# Keep every non-trivial numeric literal here so tuning is a one-file change
# and pytest can import the same values the pipeline does.
# ---------------------------------------------------------------------------

# Socrata open-data page limit (Cambridge / Somerville) — 5000 is the API cap
# for a single request without pagination.
SOCRATA_PAGE_LIMIT = 5000

# Boston CKAN food-license pagination: page size + how far we walk before
# we stop. The dataset is ~30k rows; we only ever need the first few pages
# once BOSTON_FOOD_MAX_ROWS is hit.
BOSTON_FOOD_PAGE_SIZE = 1000
BOSTON_FOOD_OFFSET_CEILING = 5000

# Boston food licenses dominate raw volume and have low actionable signal
# without a phone. Cap per the Phase-3 data-quality fix.
BOSTON_FOOD_MAX_ROWS = 500

# Supabase upsert batch size for public.prospects.
SUPABASE_UPSERT_BATCH_SIZE = 500

# Supabase retry bounds (tenacity wait_exponential, seconds).
SUPABASE_RETRY_MIN_S = 2
SUPABASE_RETRY_MAX_S = 20
SUPABASE_RETRY_MAX_ATTEMPTS = 3

# A normalized US phone number is always 10 digits.
PHONE_DIGIT_COUNT = 10

# Checkpoint and cache TTLs.
CHECKPOINT_TTL_SECONDS = 24 * 60 * 60
NONPROFIT_BMF_CACHE_TTL_SECONDS = 30 * 24 * 60 * 60

# Event-log batching: flush the buffer every N events (plus atexit).
EVENT_LOG_FLUSH_EVERY = 50

# Scrapers eligible for /admin/sources toggling. Kept in pipeline-call order
# so `source_config` seeding and `pipeline.collect` iterate consistently.
SOURCE_KEYS: tuple[str, ...] = (
    "osm",
    "yelp",
    "ma_hic",
    "city_licenses",
    "chambers",
    "best_of_boston",
    "program_books",
    "huntington",
    "bbb",
)

# Sources that `pipeline.collect` should invoke by default (when the DB
# source_config filter is unavailable). `best_of_boston` is kept in the
# registry but excluded here because bostonmagazine.com blocks scraping.
ENABLED_SOURCES_DEFAULT: tuple[str, ...] = tuple(
    s for s in SOURCE_KEYS if s != "best_of_boston"
)
