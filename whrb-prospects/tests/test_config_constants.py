"""Sanity tests for the centralized config constants.

Guards against accidental deletion or shape-change of constants that other
modules import from :mod:`config`.
"""
from __future__ import annotations

import config


def test_socrata_limits_reasonable() -> None:
    assert config.SOCRATA_PAGE_LIMIT >= 1000
    assert config.BOSTON_FOOD_PAGE_SIZE > 0
    assert config.BOSTON_FOOD_OFFSET_CEILING >= config.BOSTON_FOOD_PAGE_SIZE


def test_supabase_retry_bounds() -> None:
    assert config.SUPABASE_RETRY_MAX_ATTEMPTS >= 1
    assert config.SUPABASE_RETRY_MIN_S > 0
    assert config.SUPABASE_RETRY_MAX_S >= config.SUPABASE_RETRY_MIN_S


def test_phone_digit_count_is_ten() -> None:
    assert config.PHONE_DIGIT_COUNT == 10


def test_checkpoint_ttl_positive() -> None:
    assert config.CHECKPOINT_TTL_SECONDS > 0
    assert config.NONPROFIT_BMF_CACHE_TTL_SECONDS > 0


def test_batch_size_positive() -> None:
    assert config.SUPABASE_UPSERT_BATCH_SIZE > 0


def test_enabled_sources_subset_of_source_keys() -> None:
    assert set(config.ENABLED_SOURCES_DEFAULT).issubset(set(config.SOURCE_KEYS))


def test_best_of_boston_disabled_by_default() -> None:
    """Stage 5.5 invariant: known-broken scrapers stay out of the default run."""
    assert "best_of_boston" not in config.ENABLED_SOURCES_DEFAULT
    assert "best_of_boston" in config.SOURCE_KEYS  # still registered
