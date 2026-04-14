"""Shared configuration: ZIPs, categories, thresholds."""

# WHRB 95.3 signal-strong ZIPs
WHRB_ZIPS = [
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
]

# Bounding box covering the WHRB ZIP list (min_lat, min_lon, max_lat, max_lon)
WHRB_BBOX = (42.3200, -71.1700, 42.4100, -71.0500)

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
