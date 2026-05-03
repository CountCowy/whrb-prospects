"""Tests for util.tags pure helpers.

These cover the deterministic mappings that don't require the Supabase
vocab table:

* ``affiliation_for_zip``  — ZIP → metro affiliation.
* ``osm_category_to_tags`` — OSM ``k=v`` → ``(sector, operating_model)``.
* ``yelp_alias_to_tags``    — Yelp alias prefix → ``(sector, operating_model)``.
* ``city_category_to_tags`` — city-license dataset/category → tags.

``build_tag_set`` is intentionally NOT covered here — it consults the
Supabase-backed vocab cache, which the autouse ``stub_event_log``
fixture in conftest doesn't stub. A separate Tier-2 test could cover it
behind a vocab-cache mock; not in scope for this PR.
"""
from __future__ import annotations

import pytest

from util import tags


class TestAffiliationForZip:
    def test_cambridge_zip_maps_to_cambridge(self) -> None:
        # Harvard Square cluster.
        assert tags.affiliation_for_zip("02138") == "cambridge_based"
        assert tags.affiliation_for_zip("02139") == "cambridge_based"

    def test_boston_zip_maps_to_boston(self) -> None:
        assert tags.affiliation_for_zip("02116") == "boston_based"  # Back Bay
        assert tags.affiliation_for_zip("02118") == "boston_based"  # South End

    def test_outer_ring_maps_to_greater_boston(self) -> None:
        # Brookline, Newton, Watertown — outer signal ring.
        assert tags.affiliation_for_zip("02446") == "greater_boston"

    def test_unknown_zip_returns_none(self) -> None:
        assert tags.affiliation_for_zip("90210") is None  # Beverly Hills

    def test_handles_none_and_empty(self) -> None:
        assert tags.affiliation_for_zip(None) is None
        assert tags.affiliation_for_zip("") is None

    def test_truncates_zip_plus_4(self) -> None:
        # ZIP+4 form ('02138-1234') should still resolve to Cambridge.
        assert tags.affiliation_for_zip("02138-1234") == "cambridge_based"

    def test_strips_whitespace_and_coerces_to_str(self) -> None:
        assert tags.affiliation_for_zip("  02138  ") == "cambridge_based"
        assert tags.affiliation_for_zip(2138) is None  # int 2138 != "02138"


class TestOsmCategoryToTags:
    @pytest.mark.parametrize(
        ("category", "expected"),
        [
            ("amenity=theatre", ("arts", "venue")),
            ("amenity=restaurant", ("hospitality", "retailer")),
            ("shop=jewelry", ("retail", "retailer")),
            ("amenity=dentist", ("medical", "service_provider")),
            ("craft=plumber", ("home_services", "service_provider")),
            ("office=lawyer", ("finance", "service_provider")),
            ("office=estate_agent", ("real_estate", "service_provider")),
            ("leisure=fitness_centre", ("hospitality", "service_provider")),
        ],
    )
    def test_known_categories_map_correctly(
        self, category: str, expected: tuple[str | None, str | None]
    ) -> None:
        assert tags.osm_category_to_tags(category) == expected

    def test_unknown_category_returns_pair_of_none(self) -> None:
        assert tags.osm_category_to_tags("amenity=parking") == (None, None)

    def test_none_or_empty_returns_pair_of_none(self) -> None:
        assert tags.osm_category_to_tags(None) == (None, None)
        assert tags.osm_category_to_tags("") == (None, None)


class TestYelpAliasToTags:
    @pytest.mark.parametrize(
        ("alias", "expected"),
        [
            ("landscaping", ("home_services", "service_provider")),
            ("plumber", ("home_services", "service_provider")),
            ("restaurant", ("hospitality", "retailer")),
            ("bookstore", ("retail", "retailer")),  # 'book' substring
        ],
    )
    def test_single_alias_matches(
        self, alias: str, expected: tuple[str | None, str | None]
    ) -> None:
        assert tags.yelp_alias_to_tags(alias) == expected

    def test_first_matching_part_wins_when_multiple(self) -> None:
        # Comma-delimited Yelp form. The first part that matches *any*
        # heuristic key wins; once a part matches we stop scanning.
        result = tags.yelp_alias_to_tags("plumber,electrician,roofer")
        assert result == ("home_services", "service_provider")

    def test_no_match_returns_pair_of_none(self) -> None:
        assert tags.yelp_alias_to_tags("widget_factory") == (None, None)

    def test_handles_none_and_empty(self) -> None:
        assert tags.yelp_alias_to_tags(None) == (None, None)
        assert tags.yelp_alias_to_tags("") == (None, None)
        assert tags.yelp_alias_to_tags("   ") == (None, None)


class TestCityCategoryToTags:
    def test_boston_food_always_hospitality_retailer(self) -> None:
        # Source-driven: every boston_food row is hospitality/retailer
        # regardless of category text.
        assert tags.city_category_to_tags("boston_food", None) == (
            "hospitality",
            "retailer",
        )
        assert tags.city_category_to_tags("boston_food", "anything") == (
            "hospitality",
            "retailer",
        )

    def test_cambridge_diversity_food_categories(self) -> None:
        assert tags.city_category_to_tags(
            "cambridge_diversity", "Restaurant License"
        ) == ("hospitality", "retailer")

    def test_cambridge_diversity_retail_categories(self) -> None:
        assert tags.city_category_to_tags(
            "cambridge_diversity", "Retail Store License"
        ) == ("retail", "retailer")

    def test_cambridge_diversity_health_categories(self) -> None:
        assert tags.city_category_to_tags(
            "cambridge_diversity", "Health and Medical Practice"
        ) == ("medical", "service_provider")

    def test_cambridge_diversity_trade_categories(self) -> None:
        assert tags.city_category_to_tags(
            "cambridge_diversity", "General Construction"
        ) == ("home_services", "service_provider")

    def test_cambridge_diversity_unknown_returns_none(self) -> None:
        assert tags.city_category_to_tags(
            "cambridge_diversity", "Office Lease"
        ) == (None, None)

    def test_somerville_permits_food_or_liquor(self) -> None:
        assert tags.city_category_to_tags(
            "somerville_permits", "Food Establishment"
        ) == ("hospitality", "retailer")
        assert tags.city_category_to_tags(
            "somerville_permits", "Liquor License"
        ) == ("hospitality", "retailer")

    def test_somerville_permits_occupancy_returns_none(self) -> None:
        # Generic occupancy permits are too noisy to tag a sector.
        assert tags.city_category_to_tags(
            "somerville_permits", "Certificate of Occupancy"
        ) == (None, None)

    def test_unknown_source_returns_none(self) -> None:
        assert tags.city_category_to_tags("yelp", "anything") == (None, None)
