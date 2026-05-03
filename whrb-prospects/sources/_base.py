"""Lightweight typing contract for source modules.

This file is the post-T7 tech-debt sweep's "ProspectSource abstraction."
After reading ``pipeline.py`` and the existing helpers it became clear that
the originally-planned ``make_row`` and ``safe_run`` helpers would be
**redundant** with infrastructure that already exists:

* ``pipeline._safe_cached`` already does the outer error boundary for
  every source — try/except, ``event_log.error("source_failed", ...)``,
  zero-row warning, source-level checkpoint cache. A ``safe_run`` helper
  inside a source's ``run_all`` would either swallow exceptions before
  ``_safe_cached`` could see them (silently masking failures) or
  double-emit error events.
* ``sources._t7_common.build_row`` and
  ``sources._sponsor_pages_common.build_row`` already do row construction
  for the modern source families with rich, source-specific defaults
  (auto-affiliation from ZIP, tag-set assembly, etc.). A generic
  ``make_row`` would either duplicate them or be unused.

What's left that genuinely adds value: a **typing contract**. The CSV
column list in ``pipeline.CSV_COLUMNS`` is the source of truth for the
final row shape, but no module exposes that shape as a type.
``pipeline._safe_cached`` is annotated as ``Callable[[], list[dict]]``,
which gives mypy nothing to verify. Defining ``ProspectRow`` and
``RunAll`` here lets ``pipeline.py`` (and any source that opts in)
declare the contract precisely.

Public exports:

* :class:`ProspectRow` — TypedDict mirroring ``pipeline.CSV_COLUMNS``
  with ``total=False`` so partial rows from sources are valid. This is
  the pre-enrichment shape; downstream stages (dedupe, hunter, supabase
  sync) populate the rest.
* :data:`RunAll` — type alias for a source module's entry point.
* :class:`ProspectSource` — Protocol for the structural type of a
  source module. Useful where a callable doesn't capture the
  module-level convention (e.g. when documenting that a module exposes
  ``run_all`` as part of its public API).

Future PRs may promote a shared ``make_row`` helper for the legacy
sources (``chambers``, ``city_licenses``, ``osm_overpass``, etc.) that
construct dicts inline — they're the only code path that doesn't already
go through one of the per-batch helpers. That would be a natural
follow-up; not in scope here.
"""
from __future__ import annotations

from collections.abc import Callable
from typing import Any, Protocol, TypeAlias, TypedDict


class ProspectRow(TypedDict, total=False):
    """Canonical pre-enrichment shape of a row emitted by a source.

    Mirrors the column list in :data:`pipeline.CSV_COLUMNS`. ``total=False``
    so a source can omit any field it doesn't have signal for. The pipeline's
    enrichment phases (dedupe, BMF, hunter/apollo, contact_scraper, supabase
    sync) populate the rest before the final CSV write.

    Field semantics:

    * ``company_name`` is the only field a source must always set.
    * ``source`` should be the source's stable key (matches the
      ``source_config`` row and the label passed to ``_safe_cached``).
    * ``tier`` is one of ``A`` / ``B`` / ``C`` per ``config.TIER_*``.
    * ``tags`` is the per-axis dict assembled by
      :func:`util.tags.build_tag_set`. Sources that don't emit tags can
      omit it; downstream ``_serialize_tags_to_csv`` treats absent keys
      as empty.
    """

    # Identity
    company_name: str
    source: str
    tier: str

    # Contact / address
    website: str | None
    company_phone: str | None
    company_email: str | None
    sales_email: str | None
    contact_name: str | None
    contact_title: str | None
    contact_email: str | None
    contact_phone: str | None
    contact_linkedin: str | None
    address: str | None
    zip: str | None  # 5-char US ZIP

    # Categorisation
    category: str | None
    rating: float | None
    review_count: int | None

    # Pipeline-owned
    priority_score: float | None
    seasonality_window: str | None
    pipeline_notes: str | None

    # Nonprofit enrichment (Stage 4+)
    is_nonprofit: bool | None
    nonprofit_source: str | None
    ein: str | None

    # Tag system (Stage T1+). Per-axis lists keyed by axis name.
    tags: dict[str, list[str]]


#: A source module's public entry point. Sources MUST expose a top-level
#: function with this signature; ``pipeline.collect`` invokes it via
#: :func:`pipeline._safe_cached`.
RunAll: TypeAlias = Callable[[], list[ProspectRow]]


class ProspectSource(Protocol):
    """Structural type for a "module that emits prospects."

    Most sources are flat modules (not classes), so this Protocol's main
    use is in narrative documentation and as the type of values stored
    in any future source registry. Module-level structural typing means
    a module satisfies this Protocol if it has a ``run_all`` attribute
    matching :data:`RunAll`.
    """

    SOURCE_KEY: str

    def run_all(self) -> list[ProspectRow]:
        """Collect and return rows for this source.

        Implementations should let exceptions propagate — the pipeline's
        outer ``_safe_cached`` wrapper catches, logs ``source_failed``,
        and returns an empty list so downstream phases continue. Catching
        in ``run_all`` and silently returning ``[]`` defeats that
        observability path.
        """
        ...


# Re-exports kept narrow on purpose. Anything else (event_log shapes,
# checkpoint helpers, normalization) stays where it lives.
__all__ = ["ProspectRow", "ProspectSource", "RunAll"]


# Keep ``Any`` referenced so static analysis doesn't drop the import (we
# may extend ProspectRow with arbitrary-shaped optional fields in future
# PRs without forcing churn on this file).
_: Any = None
