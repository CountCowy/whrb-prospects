"""Tests for db.supabase_sync helpers — no network, no Supabase client."""
from __future__ import annotations

import math
from unittest.mock import MagicMock

from db.supabase_sync import (
    IN_QUERY_CHUNK_SIZE,
    _apply_field_validators,
    _as_str,
    _build_httpx_client,
    _build_insert,
    _coerce,
    _execute_bulk_updates,
    _fetch_existing_by_name,
    _patch_existing,
    _pipeline_source_for,
    _split_alt_fields,
    business_key,
)


class TestAsStr:
    def test_none(self) -> None:
        assert _as_str(None) is None

    def test_nan(self) -> None:
        assert _as_str(math.nan) is None

    def test_empty_whitespace(self) -> None:
        assert _as_str("   ") is None
        assert _as_str("") is None

    def test_numbers_become_strings(self) -> None:
        assert _as_str(42) == "42"

    def test_strips(self) -> None:
        assert _as_str("  hi  ") == "hi"


class TestCoerce:
    def test_nan_becomes_none(self) -> None:
        assert _coerce(math.nan) is None

    def test_empty_string_becomes_none(self) -> None:
        assert _coerce("") is None
        assert _coerce("   ") is None

    def test_number_passes_through(self) -> None:
        assert _coerce(3) == 3
        assert _coerce(2.5) == 2.5


class TestBusinessKey:
    def test_phone_key_wins(self) -> None:
        bk = business_key({"company_name": "X", "company_phone": "(617) 495-3400"})
        assert bk == "phone:6174953400"

    def test_contact_phone_fallback(self) -> None:
        bk = business_key({"company_name": "X", "contact_phone": "617-495-3400"})
        assert bk == "phone:6174953400"

    def test_name_zip_when_no_phone(self) -> None:
        bk = business_key({"company_name": "Cafe Luna", "zip": "02139"})
        assert bk == "name:cafe luna|02139"

    def test_short_phone_falls_through_to_name(self) -> None:
        bk = business_key({"company_name": "Cafe", "company_phone": "123", "zip": "02138"})
        assert bk == "name:cafe|02138"

    def test_name_only(self) -> None:
        assert business_key({"company_name": "Solo"}) == "name:solo"

    def test_returns_none_when_nothing_usable(self) -> None:
        assert business_key({"zip": "02138"}) is None

    def test_invalid_nanp_area_code_falls_through_to_name(self) -> None:
        # The Reagle bug: a hallucinated 10-digit phone with a non-existent
        # area code (114) must NOT become a phone: key — fall through to
        # name|zip so the cross-run lookup can match an existing prospect.
        bk = business_key({
            "company_name": "Reagle Music Theater",
            "company_phone": "1145128678",
            "zip": "02452",
        })
        assert bk == "name:reagle music theater|02452"

    def test_invalid_nanp_with_no_zip_falls_through_to_name_only(self) -> None:
        bk = business_key({
            "company_name": "Reagle Music Theater",
            "company_phone": "5275619254",
        })
        assert bk == "name:reagle music theater"

    def test_toll_free_accepted_as_phone_key(self) -> None:
        # User confirmed: 800/833/844/855/866/877/888 count as valid for keying.
        for tf in ("8005551212", "8775551212", "8665551212", "8335551212"):
            bk = business_key({"company_name": "X", "company_phone": tf})
            assert bk == f"phone:{tf}"

    def test_int_max_sentinel_falls_through_to_name(self) -> None:
        # The deebeff6 bug: 2147483647 has a real Dallas NPA (214) so it
        # passes VALID_NANP_AREA_CODES, but it's INT_MAX masquerading as a
        # phone — four unrelated companies in that run all collapsed onto
        # `phone:2147483647`. The PHONE_SENTINELS check inside
        # business_key now forces the row to fall through to name|zip.
        bk = business_key({
            "company_name": "Boston Globe",
            "company_phone": "2147483647",
            "zip": "02210",
        })
        assert bk == "name:boston globe|02210"

    def test_repdigit_sentinel_falls_through_to_name(self) -> None:
        bk = business_key({
            "company_name": "Placeholder Co",
            "company_phone": "8888888888",
            "zip": "02138",
        })
        assert bk == "name:placeholder co|02138"


class TestSplitAltFields:
    def test_splits_alt_prefix(self) -> None:
        base, alt = _split_alt_fields(
            {"company_name": "X", "website": "x.com", "alt_website": "y.com"}
        )
        assert base == {"company_name": "X", "website": "x.com"}
        assert alt == {"website": "y.com"}


class TestApplyFieldValidators:
    def test_valid_row_no_rejections(self) -> None:
        payload = {
            "ein": "04-2103594",
            "company_phone": "(617) 495-3400",
            "contact_phone": None,
        }
        assert _apply_field_validators(payload, "phone:6174953400") == 0
        assert payload["ein"] == "04-2103594"
        assert payload["company_phone"] == "(617) 495-3400"

    def test_malformed_ein_becomes_none_and_counts(self, stub_event_log) -> None:
        payload = {"ein": "garbage", "company_phone": "617-495-3400"}
        rej = _apply_field_validators(payload, "phone:6174953400")
        assert rej == 1
        assert payload["ein"] is None
        assert stub_event_log.by_category("ein_invalid")

    def test_malformed_phone_counts(self, stub_event_log) -> None:
        payload = {"ein": None, "company_phone": "555", "contact_phone": None}
        rej = _apply_field_validators(payload, "name:test|02138")
        assert rej == 1
        assert payload["company_phone"] is None
        assert stub_event_log.by_category("phone_invalid")

    def test_multiple_rejections_counted_separately(self, stub_event_log) -> None:
        payload = {"ein": "bad", "company_phone": "x", "contact_phone": "y"}
        rej = _apply_field_validators(payload, "name:test|02138")
        assert rej == 3


class TestBuildInsert:
    def test_builds_complete_payload(self) -> None:
        row = {"company_name": "X", "website": "x.com", "priority_score": 42}
        payload, rej, _ = _build_insert(row, "name:x", {}, "2026-04-19T00:00:00+00:00")
        assert payload["business_key"] == "name:x"
        assert payload["created_source"] == "pipeline"
        assert payload["company_name"] == "X"
        assert payload["priority_score"] == 42
        assert payload["pipeline_last_seen_at"] == "2026-04-19T00:00:00+00:00"
        assert rej == 0

    def test_review_count_coerced_to_int(self) -> None:
        payload, _, _ = _build_insert(
            {"company_name": "X", "review_count": "123"}, "name:x", {}, "t"
        )
        assert payload["review_count"] == 123

    def test_bad_review_count_falls_back_to_none(self) -> None:
        payload, _, _ = _build_insert(
            {"company_name": "X", "review_count": "not a number"}, "name:x", {}, "t"
        )
        assert payload["review_count"] is None


class TestPatchExisting:
    def test_locked_field_skipped(self) -> None:
        row = {"company_name": "ScrapedName"}
        existing = {"id": "abc", "user_overrides": {"company_name": True}}
        patch, _, _ = _patch_existing(row, existing, {}, "t", "name:test")
        assert "company_name" not in patch

    def test_composite_is_nonprofit_locks_ein_and_source(self) -> None:
        row = {"is_nonprofit": True, "ein": "04-2103594", "nonprofit_source": "irs_bmf"}
        existing = {"id": "abc", "user_overrides": {"is_nonprofit": True}}
        patch, _, _ = _patch_existing(row, existing, {}, "t", "name:test")
        assert "is_nonprofit" not in patch
        assert "ein" not in patch
        assert "nonprofit_source" not in patch

    def test_priority_score_refreshed_when_unlocked(self) -> None:
        row = {"priority_score": 99}
        patch, _, _ = _patch_existing(row, {"user_overrides": {}}, {}, "t", "name:t")
        assert patch["priority_score"] == 99

    def test_priority_score_locked_skipped(self) -> None:
        row = {"priority_score": 99}
        patch, _, _ = _patch_existing(
            row, {"user_overrides": {"priority_score": True}}, {}, "t", "name:t"
        )
        assert "priority_score" not in patch

    def test_none_value_does_not_overwrite(self) -> None:
        row = {"company_phone": None, "company_name": "X"}
        patch, _, _ = _patch_existing(row, {"user_overrides": {}}, {}, "t", "name:x")
        assert "company_phone" not in patch

    def test_invalid_phone_flows_to_validator(self, stub_event_log) -> None:
        row = {"company_phone": "555"}
        patch, rej, _ = _patch_existing(row, {"user_overrides": {}}, {}, "t", "name:x")
        assert rej == 1
        assert patch["company_phone"] is None


# ---------------------------------------------------------------------------
# 010 — multi-email gate + provenance
# ---------------------------------------------------------------------------


class TestPipelineSourceFor:
    def test_default_is_pipeline_scraper(self) -> None:
        assert _pipeline_source_for({"company_name": "X"}) == "pipeline_scraper"

    def test_hunter_marker(self) -> None:
        row = {"_contact_email_source": "pipeline_hunter"}
        assert _pipeline_source_for(row) == "pipeline_hunter"

    def test_apollo_marker(self) -> None:
        row = {"_contact_email_source": "pipeline_apollo"}
        assert _pipeline_source_for(row) == "pipeline_apollo"

    def test_unrecognized_marker_falls_back(self) -> None:
        row = {"_contact_email_source": "manual_rep"}  # not a pipeline source
        assert _pipeline_source_for(row) == "pipeline_scraper"


class TestBuildInsertEmail010:
    def test_pending_email_when_contact_email_present(self) -> None:
        row = {
            "company_name": "X",
            "contact_email": "FOO@bar.com",
            "_contact_email_source": "pipeline_hunter",
        }
        payload, _, pending = _build_insert(row, "name:x", {}, "t")
        assert "contact_email" not in payload  # 010: scalar is trigger-mirrored
        assert pending == {
            "email": "FOO@bar.com",  # case preserved; lower() index handles dedupe
            "source": "pipeline_hunter",
            "is_primary": True,
        }

    def test_no_pending_email_when_contact_email_absent(self) -> None:
        row = {"company_name": "X"}
        _, _, pending = _build_insert(row, "name:x", {}, "t")
        assert pending is None

    def test_pending_email_default_source_is_scraper(self) -> None:
        row = {"company_name": "X", "contact_email": "a@b.com"}
        _, _, pending = _build_insert(row, "name:x", {}, "t")
        assert pending is not None
        assert pending["source"] == "pipeline_scraper"


class TestPatchExistingEmailGate010:
    def test_gate_skips_when_count_already_positive(self) -> None:
        row = {
            "contact_email": "new@x.com",
            "_contact_email_source": "pipeline_apollo",
        }
        existing = {
            "id": "00000000-0000-0000-0000-000000000001",
            "user_overrides": {},
            "contact_email_count": 1,
        }
        _, _, pending = _patch_existing(row, existing, {}, "t", "name:test")
        assert pending is None

    def test_gate_emits_when_count_zero_and_email_present(self) -> None:
        row = {
            "contact_email": "fresh@x.com",
            "_contact_email_source": "pipeline_hunter",
        }
        existing = {
            "id": "00000000-0000-0000-0000-000000000002",
            "user_overrides": {},
            "contact_email_count": 0,
        }
        _, _, pending = _patch_existing(row, existing, {}, "t", "name:test")
        assert pending == {
            "prospect_id": "00000000-0000-0000-0000-000000000002",
            "email": "fresh@x.com",
            "source": "pipeline_hunter",
            "is_primary": True,
        }

    def test_gate_no_email_in_row_no_pending(self) -> None:
        row = {"company_name": "X"}
        existing = {
            "id": "00000000-0000-0000-0000-000000000003",
            "user_overrides": {},
            "contact_email_count": 0,
        }
        _, _, pending = _patch_existing(row, existing, {}, "t", "name:x")
        assert pending is None

    def test_gate_treats_missing_count_as_zero(self) -> None:
        # Defensive: a fetcher that doesn't include contact_email_count
        # should not silently skip emails. Treat absence as 0.
        row = {"contact_email": "a@b.com"}
        existing = {"id": "abc", "user_overrides": {}}
        _, _, pending = _patch_existing(row, existing, {}, "t", "name:x")
        assert pending is not None
        assert pending["email"] == "a@b.com"

    def test_patch_excludes_contact_email_scalar(self) -> None:
        row = {"contact_email": "no@scalar.com", "company_name": "X"}
        existing = {
            "id": "abc",
            "user_overrides": {},
            "contact_email_count": 0,
        }
        patch, _, _ = _patch_existing(row, existing, {}, "t", "name:x")
        assert "contact_email" not in patch  # 010: never written directly


# ---------------------------------------------------------------------------
# Cross-run dedupe: _fetch_existing_by_name builds the name->key index that
# lets sync() rewrite a fresh ``name:`` key onto an existing prospect.
# ---------------------------------------------------------------------------


class _StubResult:
    def __init__(self, data: list[dict]) -> None:
        self.data = data


class _StubProspectsQuery:
    """Minimal PostgREST chain stub for the _fetch_existing_by_name read."""

    def __init__(self, rows: list[dict]) -> None:
        self._rows = rows
        self._start = 0
        self._end: int | None = None

    def select(self, *_args: object, **_kwargs: object) -> _StubProspectsQuery:
        return self

    def order(self, *_args: object, **_kwargs: object) -> _StubProspectsQuery:
        return self

    def range(self, start: int, end_inclusive: int) -> _StubProspectsQuery:
        self._start = start
        self._end = end_inclusive
        return self

    def execute(self) -> _StubResult:
        end = (self._end if self._end is not None else len(self._rows) - 1) + 1
        return _StubResult(self._rows[self._start:end])


class _StubClient:
    def __init__(self, prospects: list[dict]) -> None:
        self._prospects = prospects

    def table(self, name: str) -> _StubProspectsQuery:
        if name != "prospects":
            raise AssertionError(f"unexpected table {name!r}")
        return _StubProspectsQuery(list(self._prospects))


class TestFetchExistingByName:
    def _row(
        self,
        name: str,
        bk: str,
        zip_: str = "02138",
        score: int = 50,
        created_at: str = "2026-04-19T00:00:00+00:00",
    ) -> dict:
        return {
            "business_key": bk,
            "company_name": name,
            "zip": zip_,
            "priority_score": score,
            "created_at": created_at,
        }

    def test_builds_with_zip_and_no_zip_indexes(self) -> None:
        client = _StubClient([
            self._row("Cafe Luna", "phone:6174953400", "02139"),
            self._row("Solo Venue", "name:solo venue", ""),  # no zip
        ])
        with_zip, no_zip = _fetch_existing_by_name(client)
        assert with_zip == {("cafe luna", "02139"): "phone:6174953400"}
        # Both rows should appear in the no-zip fallback index.
        assert no_zip == {
            "cafe luna": "phone:6174953400",
            "solo venue": "name:solo venue",
        }

    def test_higher_score_wins_on_collision(self) -> None:
        client = _StubClient([
            self._row("Reagle Music Theater", "phone:1145128678", "02452", score=10),
            self._row("Reagle Music Theater", "phone:7818915600", "02452", score=100),
        ])
        with_zip, _ = _fetch_existing_by_name(client)
        # The higher-score row's key is preferred — that's the canonical one
        # we want future runs to fold onto.
        assert with_zip[("reagle music theater", "02452")] == "phone:7818915600"

    def test_earlier_created_at_breaks_score_tie(self) -> None:
        client = _StubClient([
            self._row("X", "name:x|02138", score=50, created_at="2026-04-22T00:00:00+00:00"),
            self._row("X", "phone:6174953400", score=50, created_at="2026-04-18T00:00:00+00:00"),
        ])
        with_zip, _ = _fetch_existing_by_name(client)
        # Same score → earlier created_at wins (the older, more-stable row).
        assert with_zip[("x", "02138")] == "phone:6174953400"

    def test_normalizes_company_name_for_lookup(self) -> None:
        # The lookup key is the same _norm_name dedupe uses, so a future row
        # with weird casing/punctuation still finds the canonical entry.
        client = _StubClient([
            self._row("Reagle Music Theater!", "phone:7818915600", "02452"),
        ])
        with_zip, no_zip = _fetch_existing_by_name(client)
        assert ("reagle music theater", "02452") in with_zip
        assert "reagle music theater" in no_zip

    def test_skips_rows_without_name(self) -> None:
        client = _StubClient([
            {"business_key": "phone:6174953400", "company_name": None,
             "zip": "02138", "priority_score": 50, "created_at": "t"},
            self._row("Real One", "name:real one|02138"),
        ])
        with_zip, no_zip = _fetch_existing_by_name(client)
        assert ("", "02138") not in with_zip
        assert with_zip == {("real one", "02138"): "name:real one|02138"}
        assert no_zip == {"real one": "name:real one|02138"}


class TestInQueryChunkSize:
    """``.in_(col, values)`` filter chunk size — must keep URLs short enough
    to clear Cloudflare's WAF / nginx ``large_client_header_buffers`` on
    the proxy chain in front of Supabase.

    Run ``dc3cd1ab`` failed because the previous chunk size (500) built
    ~22 KB tag-sync URLs that Cloudflare rejected from GH-Actions IPs
    with plain ``b'Bad Request'`` (residential IPs accepted them, which
    is why local probes succeeded). 100 keeps the URL under 8 KB on the
    worst-case shape (chunk × prospect_ids + 83 vocab tag_ids).
    """

    def _synthetic_url_size(self, n_prospect_ids: int, n_tag_ids: int) -> int:
        """Approximate URL size for a tag-sync precount-shaped query.

        Mirrors the supabase-py URL builder's encoding: each value is
        URL-encoded (UUIDs → 36 chars, commas → ``%2C``, parens → ``%28``
        / ``%29``), wrapped in ``col=in.(...)``. Base URL + select clause
        adds ~120 chars.
        """
        base = len("https://kolfijjavwruwzctmnlx.supabase.co/rest/v1/prospect_tags")
        select = len("?select=prospect_id%2Ctag_id")

        # Each value: 36 chars (UUID). URL-encoded comma is %2C (3 chars).
        # `col=in.%28...%29` -- `in.` literal + `%28` + values + `%29`.
        def per_filter(n: int) -> int:
            return (
                len("&prospect_id=in.%28")
                + 36 * n
                + 3 * (n - 1)
                + len("%29")
            )

        return base + select + per_filter(n_prospect_ids) + per_filter(n_tag_ids)

    def test_constant_keeps_url_under_8kb(self) -> None:
        # Worst case: chunk * prospect_ids + 83 vocab tag_ids in same URL.
        size = self._synthetic_url_size(IN_QUERY_CHUNK_SIZE, n_tag_ids=83)
        # 8192 = nginx default ``large_client_header_buffers`` first-line
        # bucket; values above this triggered the production failure.
        assert size < 8192, (
            f"chunk size {IN_QUERY_CHUNK_SIZE} produces ~{size}-byte URLs; "
            "exceeds nginx 8 KB default and risks Cloudflare 400 'Bad Request' "
            "from GH-Actions runner IPs (run dc3cd1ab repro)."
        )

    def test_constant_value_is_conservative(self) -> None:
        # Belt and suspenders: the value itself sits in a sane window.
        # Too small => too many round trips; too large => URL-length risk.
        # 50-200 is the comfortable band given UUID chunk geometry.
        assert 50 <= IN_QUERY_CHUNK_SIZE <= 200


class TestBuildHttpxClient:
    """Run a59a1ca4 failed because postgrest-py defaults ``http2=True`` and
    Supabase's edge proxy GOAWAY'd on a single connection after ~20K
    streams. The fix forces HTTP/1.1; these tests lock in that contract.
    """

    def test_http2_disabled(self) -> None:
        client = _build_httpx_client()
        try:
            # httpx exposes the H2 flag through the transport's connection
            # pool. The bug was a HTTP/2 ``GOAWAY`` mid-stream — proving
            # H2 is off proves the bug class can't recur via this client.
            pool = client._transport._pool
            assert getattr(pool, "_http2", False) is False, (
                "Supabase pipeline client must pin HTTP/1.1; HTTP/2's "
                "per-connection stream cap caused run a59a1ca4."
            )
        finally:
            client.close()

    def test_returns_an_httpx_client(self) -> None:
        import httpx

        client = _build_httpx_client()
        try:
            assert isinstance(client, httpx.Client)
            assert client.timeout.read == 120.0
        finally:
            client.close()


class TestExecuteBulkUpdates:
    """Verify the bulk UPSERT path the sync() function now takes for
    updates. Run a59a1ca4 made one HTTP request per row update; bulk
    cuts that ~100x and groups by patch column signature so PostgREST
    can emit a single ``ON CONFLICT DO UPDATE`` per group.
    """

    def _stub_client(self) -> tuple[MagicMock, list]:
        """Return a Supabase client mock that records ``upsert`` calls."""
        upsert_calls: list = []
        client = MagicMock()
        chain = client.table.return_value
        chain.upsert.return_value.execute.return_value = MagicMock(data=[])

        def record_upsert(payload, **kwargs):
            upsert_calls.append({"payload": payload, "kwargs": kwargs})
            return chain.upsert.return_value

        chain.upsert.side_effect = record_upsert
        return client, upsert_calls

    def test_empty_updates_does_nothing(self) -> None:
        client, calls = self._stub_client()
        updated, failed = _execute_bulk_updates(client, [], failed_so_far=0)
        assert updated == 0
        assert failed == 0
        assert calls == []

    def test_single_shape_emits_one_upsert(self) -> None:
        client, calls = self._stub_client()
        to_update = [
            ("uuid-1", {"company_name": "A", "tier": "B"}),
            ("uuid-2", {"company_name": "B", "tier": "C"}),
            ("uuid-3", {"company_name": "C", "tier": "A"}),
        ]
        updated, failed = _execute_bulk_updates(client, to_update, failed_so_far=0)
        assert updated == 3
        assert failed == 0
        # All three rows share a patch shape → exactly one bulk UPSERT.
        assert len(calls) == 1
        call = calls[0]
        assert call["kwargs"]["on_conflict"] == "id"
        assert len(call["payload"]) == 3
        # Each row carries the id alongside the patched columns.
        ids = {r["id"] for r in call["payload"]}
        assert ids == {"uuid-1", "uuid-2", "uuid-3"}

    def test_distinct_shapes_split_into_separate_upserts(self) -> None:
        client, calls = self._stub_client()
        to_update = [
            ("uuid-1", {"company_name": "A"}),
            ("uuid-2", {"company_name": "B"}),
            # User-locked tier — different shape, must go in its own UPSERT.
            ("uuid-3", {"company_name": "C", "rating": 5}),
        ]
        updated, failed = _execute_bulk_updates(client, to_update, failed_so_far=0)
        assert updated == 3
        assert failed == 0
        # Two distinct patch shapes → two bulk UPSERTs.
        assert len(calls) == 2
        sizes = sorted(len(c["payload"]) for c in calls)
        assert sizes == [1, 2]

    def test_empty_patch_is_skipped(self) -> None:
        client, calls = self._stub_client()
        to_update = [
            ("uuid-1", {"company_name": "A"}),
            ("uuid-2", {}),  # Empty patch — nothing to update.
        ]
        updated, failed = _execute_bulk_updates(client, to_update, failed_so_far=0)
        assert updated == 1
        assert failed == 0
        assert len(calls) == 1
        assert len(calls[0]["payload"]) == 1

    def test_failed_so_far_passes_through(self) -> None:
        client, _ = self._stub_client()
        # Insert phase already counted 3 failures; bulk-update success
        # must preserve them in the returned total.
        updated, failed = _execute_bulk_updates(
            client, [("uuid-1", {"company_name": "A"})], failed_so_far=3
        )
        assert updated == 1
        assert failed == 3

    def test_bulk_failure_falls_back_to_per_row_patch(self, stub_event_log) -> None:
        # First call (bulk) raises; per-row path uses ``update().eq().execute()``.
        client = MagicMock()
        chain = client.table.return_value

        # Bulk path raises on the .upsert(...).execute() call.
        chain.upsert.return_value.execute.side_effect = RuntimeError("bulk failed")

        # Per-row PATCH path: .update(...).eq(...).execute() succeeds.
        chain.update.return_value.eq.return_value.execute.return_value = MagicMock(data=[])

        to_update = [
            ("uuid-1", {"company_name": "A"}),
            ("uuid-2", {"company_name": "B"}),
        ]
        updated, failed = _execute_bulk_updates(client, to_update, failed_so_far=0)
        # Per-row fallback rescued every row.
        assert updated == 2
        assert failed == 0
        # Fallback was logged at warn level.
        assert stub_event_log.by_category("supabase_upsert_bulk_fallback")
        # Per-row update path called once per row.
        assert chain.update.call_count == 2
