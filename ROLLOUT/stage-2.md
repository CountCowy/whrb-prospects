# Stage 2 — Pipeline sync + event logging (2026-04-18)

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

---

