# Stage 5.5 — whrb-prospects code-quality baseline (2026-04-19)

- **Started:** 2026-04-19 13:45 America/New_York
- **Branch:** `stage5.5/prospects-quality` (off `main`)
- **Rationale:** a pre-Stage-6 codebase audit surfaced eight whrb-prospects gaps
  (no pytest suite, no linter/type-checker, silent-failure patterns, no Python
  CI, no dep lockfile, scattered magic constants, undefined stub-source policy,
  post-hoc-only EIN/phone validation). Harden the pipeline before multi-user
  edits start writing back through the sync path.

### Artifacts landed

- **`whrb-prospects/pyproject.toml`** — ruff (E/F/I/B/UP/SIM/TID/RUF), mypy
  gradual-strict on `config.py` + `util/` + `enrich/dedupe.py` + `db/validators.py` + `db/nonprofit_bmf.py`, pytest config.
- **`whrb-prospects/.python-version`** — pins CPython 3.11 for local pyenv + CI setup-python parity.
- **`whrb-prospects/requirements-dev.txt`** — pytest, pytest-cov, mypy, ruff, pip-tools, types-requests, pandas-stubs.
- **`whrb-prospects/requirements.lock` + `requirements-dev.lock`** — pip-compile output; CI installs from locks for reproducibility.
- **`whrb-prospects/config.py`** — added 10 centralized constants:
  `SOCRATA_PAGE_LIMIT`, `BOSTON_FOOD_{PAGE_SIZE,OFFSET_CEILING,MAX_ROWS}`,
  `SUPABASE_UPSERT_BATCH_SIZE`, `SUPABASE_RETRY_{MIN_S,MAX_S,MAX_ATTEMPTS}`,
  `PHONE_DIGIT_COUNT`, `CHECKPOINT_TTL_SECONDS`,
  `NONPROFIT_BMF_CACHE_TTL_SECONDS`, `EVENT_LOG_FLUSH_EVERY`.
  Plus `SOURCE_KEYS` (full registry) and `ENABLED_SOURCES_DEFAULT` (excludes the
  broken `best_of_boston` scraper so a DB bootstrap failure can't re-enable it).
- **`whrb-prospects/db/validators.py`** — NEW. `validate_ein(value)` enforces `^\d{2}-\d{7}$`; `validate_phone(value)` requires ≥10 digits. Both emit `event_log.warn` with `business_key` context on rejection and return `None` so the row still syncs (field becomes SQL NULL).
- **`whrb-prospects/db/supabase_sync.py`** — `_build_insert` and `_patch_existing` now call `_apply_field_validators` before returning, so every upsert path is guarded. `sync()` summary gained a `validation_warnings` counter. Retry bounds and batch size read from `config`.
- **`whrb-prospects/util/http.py`** — `_log_event` now echoes swallowed errors to `stderr` (previously silent `pass`). Rationale: the fire-and-forget catch stays (load-order cycle defence), but catastrophic logger failures are no longer invisible.
- **`whrb-prospects/pipeline.py`** — `_safe_cached` typed as `Callable[[], list[dict]] → list[dict]`; `ENABLED_SOURCES_DEFAULT` used as the bootstrap allowlist so a failed Supabase bootstrap never silently re-enables disabled scrapers.
- **`whrb-prospects/util/checkpoint.py`** — closed typing gaps on `_atomic_write_json`, `load_latest`, `load_source`.
- **`whrb-prospects/enrich/dedupe.py`** — annotated the `match / match_list / match_idx` triple so the fuzzy-pass replacement site type-checks cleanly.
- **`whrb-prospects/db/nonprofit_bmf.py`** — renamed the inner DictReader loop variable to satisfy mypy (same `row` name previously shadowed the earlier positional-reader loop's `list[str]` type).
- **`whrb-prospects/sources/best_of_boston.py`** — docstring updated: kept in registry but excluded from `ENABLED_SOURCES_DEFAULT` until the 403 is fixed.
- **`whrb-prospects/sources/bbb.py`** — docstring explains the Playwright-selector flakiness and the `--with-bbb` opt-in policy.
- **`whrb-prospects/tests/`** — NEW. 8 modules, 125 tests:
  - `test_validators.py` — EIN regex + phone-digit guard + event-log warn contract.
  - `test_dedupe.py` — `_norm_name`, `_norm_phone`, `_best_tier`, `_completeness`, `_zip_compatible`, `_fuzz_threshold`, `_merge` (conflict-preserving alt_fields + tier upgrade independent of completeness), end-to-end `dedupe()` pass.
  - `test_normalize.py` — Socrata dict-type unwrapping edge cases.
  - `test_checkpoint.py` — TTL expiry, resume-or-rebuild, stale-schema guard, atomic write, `clear_all`.
  - `test_supabase_sync.py` — `_as_str`, `_coerce`, `business_key` derivation, `_split_alt_fields`, `_build_insert`, `_patch_existing` with single + composite locks (`is_nonprofit` ⇒ skip `ein` + `nonprofit_source`), `_apply_field_validators`.
  - `test_nonprofit_bmf.py` — `_format_ein` rejects wrong-length digit strings; `_strip_suffix_tokens` collapses "trustees of the …" + "handel and haydn society" cases; `_match_key` canonical-spot-check for Handel & Haydn / MFA.
  - `test_pipeline_helpers.py` — `score` (weights + chamber bonus + log-scaled review count), `seasonality_for`, `_safe_cached` (cache hit, exception returns `[]` not `None`, failure does NOT poison the source cache), `filter_zips`.
  - `test_http_log_event.py` — `_log_event` never re-raises (downstream exception, invalid level).
  - `test_config_constants.py` — guards against accidental deletion; pins `best_of_boston` off-by-default invariant.
  - `conftest.py` — `autouse=True` stub replaces `util.event_log` with an in-memory recorder so no test ever hits Supabase; `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` scrubbed from env at import time.
- **`.github/workflows/whrb-prospects-ci.yml`** — NEW. Triggers on PRs touching `whrb-prospects/**` or the workflow itself. Steps: setup-python 3.11 → install from lock → `ruff check .` → `mypy` → `pytest tests/`. Mirrors `whrb-web-ci.yml` shape.

### Integrity results (local)

```
$ ruff check .
All checks passed!

$ mypy
Success: no issues found in 9 source files

$ pytest tests/
125 passed in 1.58s
```

### Plan deviations

- **Dropped `ruff format --check` from CI.** A full-repo format would rewrite 37 files (~1956 lines of pure whitespace churn) on this PR alone. Format enforcement is deferred to a follow-up PR dedicated to the reformat so the Stage 5.5 diff stays reviewable.
- **Gradual-strict mypy scope.** The plan proposed enforcing on `config.py` + `pipeline.py` + `util/` + `enrich/` + `db/`. `pipeline.py` has 40+ pre-existing `list[dict] | None` errors on the resume-or-rebuild checkpoint pattern, and `sources/*` fight BeautifulSoup + Playwright typing; fixing them would balloon this PR. Narrowed to the files Stage 5.5 actually touched (`config.py`, `db/validators.py`, `db/nonprofit_bmf.py`, `enrich/dedupe.py`, `util/**`). Expanding the allow-list is a follow-up.
- **Phone validation preserves original formatting.** The plan wording ("normalize to 10 digits") would rewrite every `company_phone` cell in the DB on next rerun. Revised to "accept if ≥10 digits after stripping; keep the original string". The normalized 10-digit form already lives in `business_key`; UI can format for display.
- **`SyncResult` dataclass.** The plan proposed wrapping `sync()`'s return in a dataclass. The existing dict shape (`inserted/updated/skipped/failed/total`) is already consumed by `pipeline.py`; dataclass migration would churn every call-site without new guarantees. Added `validation_warnings` to the dict instead.

### Exit-gate criteria (all green)

- [x] `pyproject.toml` + `.python-version` + dev deps + lockfiles in place
- [x] `ruff check .` clean on `whrb-prospects/`
- [x] `mypy` clean on in-scope modules
- [x] `pytest tests/` = 125 passed
- [x] CI workflow runs lint + types + tests on PRs
- [x] `db/validators.py` + wired into `_build_insert` + `_patch_existing`
- [x] Magic constants centralized in `config.py`
- [x] `best_of_boston` off-by-default invariant encoded in `ENABLED_SOURCES_DEFAULT` and asserted in `test_config_constants.py`
- [x] ROLLOUT.md updated (this section)

**Stage 5.5 exit gate: GREEN. Stage 6 (read-only views + data grid) unblocked.**

---

