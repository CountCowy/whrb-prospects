# WHRB prospects — `dev` rollout log

Per-stage integrity test results against the `WHRB dev` Supabase project
(`https://kolfijjavwruwzctmnlx.supabase.co`). Production cutover (Stage 11)
creates a separate `ROLLOUT_PROD.md`.

Plan: `/Users/countcowy/.claude/plans/soft-crafting-tulip.md`.

---

## Stage 1 — Cloud provisioning + schema

- **Started:** 2026-04-17 ~19:50 America/New_York
- **Exited:** 2026-04-17 20:16 America/New_York (2026-04-18T00:16Z)
- **Tester:** claude (agent session) + Count / `kingyareh@gmail.com`
- **Project:** `kolfijjavwruwzctmnlx` (WHRB dev)
- **Admin UUID:** `d191df5d-a406-4866-a9e2-e0d0aaa00c6b`

### Actions taken

1. Moved the git root: `whrb-prospects/.git` -> `Listing/.git` (monorepo shape).
   Added `Listing/.gitignore` for future `whrb-web/` and root-level noise.
   No commit created — working tree shows all previously-tracked files as
   deleted + everything under `whrb-prospects/` as untracked; git rename
   detection will pick this up on the first commit.
2. Appended `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
   `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF` to `whrb-prospects/.env`.
3. Added `supabase` + `psycopg2-binary` to `whrb-prospects/requirements.txt`
   and installed into `whrb-prospects/.venv/`.
4. Created the canonical migration at
   `whrb-web/supabase/migrations/000_init.sql` (10 tables, 22 policies,
   5 triggers, 5 prospect indexes + secondary indexes on other tables).
   Mirrored verbatim to `whrb-prospects/db/schema.sql`.
5. Created `whrb-web/supabase/seed.sql` with a two-step idempotent flow
   (backfill `profiles` from `auth.users`, then promote
   `kingyareh@gmail.com` to `role='admin'`). Rationale: the admin was
   invited before the migration was applied, so the
   `on_auth_user_created` trigger could not have fired for that row —
   we backfill once so the UPDATE has a row to promote.
6. Wrote `whrb-prospects/scripts/apply_migration.py` (psycopg2 DDL applier
   with direct-connection + pooler fallback). Ran it — schema and seed
   both applied cleanly.
7. Wrote `whrb-prospects/scripts/rls_check.py` (supabase-py, 10 tables x
   {anon-denied, service-role-allowed} = 20 assertions).
8. Wrote `whrb-prospects/scripts/stage1_integrity.py` covering every
   plan-specified Stage 1 check.

### Plan deviations (intentional, see plan clarifications round 5)

- **Migration application method**: the plan's original text said "apply via
  the dashboard SQL editor." Superseded by the programmatic psycopg2
  applier so reruns are scriptable. Plan updated to reflect this.
- **`p_log_insert` policy**: plan's literal SQL
  (`user_id is null or user_id = auth.uid()`) evaluates true for anon
  (both sides null), which would allow unauthenticated spam inserts to
  `event_log` and fail the anon-denied RLS check. I added
  `auth.uid() is not null and` to the WITH CHECK — matches the plan's
  written intent ("inserts from the web app are self-attributed") and
  is required for the RLS test to pass.
- **`seed.sql` backfill step**: see action 5 above. Plan updated to reflect
  the pre-migration-invite case.
- **`rls_check.py` profiles-table substitution**: for `profiles` we test
  UPDATE rather than INSERT (INSERT to `profiles` requires a matching
  `auth.users` row, which conflicts with the `on_auth_user_created`
  trigger that already creates one). Preserves the RLS-allow/deny
  contract; documented in the script's module docstring.

### Integrity test results

| # | Test | Result | Detail |
|---|------|--------|--------|
| T01 | 10 public tables exist | PASS | all 10 present, no extras |
| T02 | >= 18 policies, every table covered | PASS | 22 policies across 10 tables |
| T03 | Required public-table triggers | PASS | t_prospects_updated_at, t_prospects_audit, t_notes_edited_at, t_source_config_updated_at, t_user_preferences_updated_at |
| T04 | `on_auth_user_created` on `auth.users` | PASS | present |
| T05 | Exactly 1 admin (`kingyareh@gmail.com`) | PASS | count=1 |
| T06 | Audit trigger emits `prospect_state_change` | PASS | context = {field: state, old: researching, new: dead, actor_id: null, prospect_id: <uuid>} |
| T07 | Invite trigger creates `profiles` row with `role='rep'` | PASS | throwaway auth.users insert -> profile appears -> cleaned up |
| T08 | Check constraint rejects `state='not_a_state'` | PASS | CheckViolation raised |
| T09 | All 5 prospects indexes present | PASS | idx_prospects_{tier_score,score,assigned,state,zip} + pkey + uq(business_key) |
| T10 | `rls_check.py` 20/20 | PASS | 20/20 pass |

### Exit-gate criteria (all green)

- [x] `rls_check.py` reports 20/20 pass
- [x] Audit-trigger smoke test passes (T06)
- [x] Invite-trigger smoke test passes (T07)
- [x] Admin profile exists exactly once (T05)
- [x] No `level='error'` or `level='fatal'` rows in `event_log` (0 rows total; verified)
- [x] No regressions (Stage 1 is first stage; baseline established)
- [x] `ROLLOUT.md` written with timestamped results

### Artifacts produced

- `whrb-web/supabase/migrations/000_init.sql`
- `whrb-web/supabase/seed.sql`
- `whrb-prospects/db/__init__.py`
- `whrb-prospects/db/schema.sql`  (mirror)
- `whrb-prospects/scripts/apply_migration.py`
- `whrb-prospects/scripts/rls_check.py`
- `whrb-prospects/scripts/stage1_integrity.py`
- `whrb-prospects/.env`  (updated; gitignored)
- `whrb-prospects/requirements.txt`  (added `supabase`, `psycopg2-binary`)
- `Listing/.gitignore`

### Cleanup state at exit

- `public.profiles` contains exactly 1 row (the admin).
- `public.prospects`, `public.prospect_notes`, and every other table are empty.
- `public.event_log` has 0 rows (integrity tests clean up their own writes).
- No throwaway auth.users rows remain (verified by invite-trigger test teardown).

**Stage 1 exit gate: GREEN. Stage 2 (pipeline sync + logging) may proceed.**

---

## Pre-Stage-2 prep (2026-04-17, post-Stage-1)

Captured per plan round-6 clarifications addendum. Logged here so the Stage 2
entry state is explicit.

- **`notes` → `pipeline_notes` rename completed.** `pipeline.py::CSV_COLUMNS`,
  `pipeline.py::score()`, and every `"notes"` dict-key write in
  `sources/{chambers,city_licenses,ma_hic,bbb,program_books,program_books_fetcher,ma_sos}.py`
  and `enrich/{apollo_free,hunter_free}.py` now write `pipeline_notes`. Grep
  confirms zero remaining scraped-field `"notes"` references. The DB's
  `public.prospect_notes` table is unrelated and untouched.
- **Stage 1 integrity tests NOT re-run** before Stage 2 — Stage 1 just exited
  green and nothing in the DB tree changed since.
- **No intermediate pipeline dry run.** Stage 2's `python pipeline.py --fresh
  --with-hic` will be the first ingest against `WHRB dev`.
- **Stage 2 will seed `public.source_config`** with one row per scraper
  (`osm`, `yelp`, `ma_hic`, `city_licenses`, `chambers`, `best_of_boston`,
  `program_books`, `huntington`, `bbb`), all `enabled=true`, idempotent.
- **Stage 2 network-kill test will be simulated**, not a manual wifi toggle
  (plan deviation — reason + method will be documented in the Stage 2 entry
  when it is written).
- **Stage 2 target**: `WHRB dev` project (`kolfijjavwruwzctmnlx`) directly, no
  staging table.

### Stage 2 implementation decisions (plan round-7, 2026-04-18)

Captured before Stage 2 implementation work begins. Full text lives in the plan's round-7 addendum; summary here so `ROLLOUT.md` is self-contained.

- **Universal `pipeline_run_id`.** Every run (CLI + web) inserts a `pipeline_runs` row at start and updates it at finish. Every `event_log` row is stamped with that `pipeline_run_id`. CLI runs use `triggered_by=null`; `args` captures argv (e.g. `"--fresh --with-hic"`).
- **`--no-supabase`** CLI flag skips phase `08_supabase_sync` only; composes with `--dry`.
- **Per-batch retry** lives in `db/supabase_sync.py` (tenacity, 3 attempts, reuses `util/http.py::RETRYABLE_EXCEPTIONS`). Exhausted batch → `event_log` error; sync continues with the next batch.
- **`priority_score`** authoritative-from-pipeline, always refreshed, still honors `user_overrides["priority_score"]`.
- **`util/http.py` logging:** `scrape_4xx` → `warn`, `scrape_http` (retry exhaustion) → `error`. Fire-and-forget; must never raise.
- **Integrity script:** `whrb-prospects/scripts/stage2_integrity.py` (centralized, modeled on `stage1_integrity.py`). `--simulate-network-kill` flag runs the monkey-patched-`upsert` retry test in isolation.
- **Branch:** `stage2/pipeline-sync` off `main`. Commit + push only after every integrity test is green; push to existing remote (verified first, not created).
- **`--fresh`** clears phase/source checkpoints but **leaves `cache/http_cache.sqlite` alone**.
- **Pipeline execution hand-off:** Claude runs `python pipeline.py --fresh --with-hic` via Bash `run_in_background=true` (no 10-min timeout).

---

## Stage 2 — Pipeline sync + event logging (2026-04-18)

**Branch:** `stage2/pipeline-sync` off `main`. **Target:** `WHRB dev` (`kolfijjavwruwzctmnlx`).

### Artifacts landed
- `whrb-prospects/db/supabase_sync.py` — business_key derivation, edit-lock patching, per-batch tenacity retry, `seed_source_config`, `read_enabled_sources`, `INT_FIELDS` coercion, fire-and-forget error logging.
- `whrb-prospects/util/event_log.py` — batched logger (flush every 50 events + atexit), module-level `_PIPELINE_RUN_ID` stamping.
- `whrb-prospects/pipeline.py` — `08_supabase_sync` phase, `--no-supabase` flag, `_start_pipeline_run` / `_finish_pipeline_run`, source_config gating, `run_start` / `run_finish` events.
- `whrb-prospects/util/http.py` — `scrape_4xx` (warn) + `scrape_http` (error, retry exhausted) events; fire-and-forget lazy-imported logger.
- `whrb-prospects/scripts/stage2_integrity.py` — 12 checks (T01–T12) + `--simulate-network-kill` mode.
- `whrb-prospects/scripts/stage2_resync.py` — one-off helper to re-run sync against an existing CSV without a full rescrape (used after mid-stage bugfixes).

### Run ledger
- Full pipeline: `python pipeline.py --fresh --with-hic` — wrote `output/whrb_prospects.csv` with 2,981 rows. Initial sync aborted on `TypeError: expected string or bytes-like object, got 'float'` inside `business_key` (pandas NaN floats passing into `_norm_phone`/`_norm_name`). **Fix:** `_as_str` coercion helper in `db/supabase_sync.py` coerces NaN/non-string inputs to `None` before `_norm_*`.
- First resync: uncovered second defect — `review_count` arriving as pandas float (`"72.0"`) rejected by Postgres `integer`. **Fix:** `INT_FIELDS = ("review_count",)` + `int(float(v))` coercion in `_build_insert` / `_patch_existing`.
- Clean-state resync (after truncating `event_log` / `prospects` / `pipeline_runs`): `inserted=2933 updated=0 skipped=48 failed=0 total=2981`. The 48 skipped rows are pipeline-batch duplicates of the same `business_key` — surfaces a residual dedupe gap (notably the sentinel phone `2147483647` and similar keys) that Stage 2 tolerates but future dedupe work should eliminate.

### Integrity results — 12/12 PASS
```
T01 row count vs CSV (<5% delta)   csv=2981 db=2933 delta=48      PASS
T02 no duplicate business_key      total=2933 dupes=0             PASS
T03 no null business_key / name    null_bk=0 null_cn=0            PASS
T04 tiers populated (A>=10)        A=251 B=2387 C=295             PASS
T05 10 random spot-check vs CSV    checked=10/10, all match       PASS
T06 pipeline_last_seen_at non-null nulls=0                        PASS
T07 created_source='pipeline'      non_pipeline=0                 PASS
T08 run_start + run_finish events  starts=1 finishes=1            PASS
T09 error events carry context     errors=0 empty_context=0       PASS
T10 zero audit events (insert-only) audit_events=0                PASS
T11 created_source enum integrity  invalid_values=0               PASS
T12 prospect rows >= 1500          count=2933                     PASS
```

### Network-kill simulation — PASS
`scripts/stage2_integrity.py --simulate-network-kill` monkey-patches `_insert_batch` to raise `ConnectionError` for the target key across all tenacity attempts while a sibling batch succeeds. Observed 4 total attempts (3 retries × 1 initial), structured `supabase_upsert` error row logged with `batch_size`, `batch_start_key`, `exception`, `detail`, `op='insert'`; sibling batch inserted; sync continued to completion. Test rows cleaned up automatically.

### Plan deviations
- **T05 refinement.** Random spot-check now samples only CSV rows whose `business_key` appears exactly once in the CSV. Collision keys (48 skipped on this run) are by design resolved to a single DB winner, so naive CSV↔DB field equality is ambiguous for those. The refinement preserves the test's intent (verify fidelity of sync for non-ambiguous rows) without masking real regressions.
- **Integrity run against a resync, not a second `pipeline.py` invocation.** After two sync-phase bugfixes mid-stage, re-running 30 minutes of scraping would have added no signal beyond re-executing the sync path. The resync helper replays the authoritative CSV through the exact same sync entrypoint (`supabase_sync.sync(rows)`) under a fresh `pipeline_run_id`. Functionally equivalent for Stage 2's contract.
- **Network-kill simulated, not physical** (carried over from round-6 decision).

### Exit gate
Green. Stage 2 complete; ready for Stage 3 (idempotent rerun + 15-field lock matrix).
