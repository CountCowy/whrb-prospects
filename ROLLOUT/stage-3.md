# Stage 3 — Idempotent rerun (2026-04-18)

**Branch:** `stage3/idempotent-rerun` off `stage2/pipeline-sync`. **Target:** `WHRB dev` (`kolfijjavwruwzctmnlx`).

### Plan deviation (pre-approved)

- **Two reruns, not three.** Per user instruction, Stage 3 runs `python pipeline.py` (no flags) twice after the Stage 2 ingest — so total pipeline invocations on this dataset = 3 (Stage 2's `--fresh --with-hic` + Stage 3 runs #2 and #3). The plan's wording about "run 2 vs run 3" row-count delta still applies directly.
- **No `--with-hic` on reruns.** Plan literally says "no flags". Checkpoints `01_collected`..`07_validated` from the Stage 2 run (still under 24h TTL) carry the HIC rows, so the reruns resume from the checkpoint and re-sync the full 2,981 CSV rows (2,933 unique business_keys after sync dedupe). No re-scrape occurred; runtime was ~9 minutes per rerun (email-validation phase dominates).

### Artifacts landed

- `whrb-prospects/scripts/stage3_plant.py` — pre-run snapshot + plants the lock/unlock/synthetic test rows. Writes `cache/stage3_snapshot.json`.
- `whrb-prospects/scripts/stage3_integrity.py` — 10 checks (T01–T10) reading the snapshot + live DB.
- `whrb-prospects/scripts/stage3_cleanup.py` — restores the lock row's original phone, clears `user_overrides`, hard-deletes the synthetic row. Idempotent.
- `cache/stage3_run1.log`, `cache/stage3_run2.log` — captured pipeline stdout for both reruns (each ends `{'inserted': 0, 'updated': 2933, 'skipped': 48, 'failed': 0, 'total': 2981}`).

### Plant step (pre-rerun)

1. Snapshot captured at `2026-04-18T18:34:59Z`: `pre_row_count=2933`, `pre_distinct_bk=2933`, full `id -> created_at` map for the 2,933 rows.
2. **Lock row** `e2a41e99-d7c8-4950-b3ae-a8907d1cc2fa` (`phone:7044231660`): `company_phone` set to `'555-TEST-LOCK'`, `user_overrides={"company_phone": true}`.
3. **Unlock row** `66ecf3ff-5564-465d-a81d-deb49e7a6fe1` (`phone:6175761010`): `company_phone` set to `'999-FAKE-UNLOCK'`, `user_overrides` left empty.
4. **Synthetic row** `99f2059b-...` (`business_key='synthetic-test-001'`): inserted with `created_source='pipeline'`, `pipeline_last_seen_at='2026-04-16T18:35:00Z'` (2 days stale).

### Run ledger

| Run | pipeline_run_id | started_at (UTC) | rows_upserted | status |
|-----|------------------|-------------------|----------------|---------|
| #2 (Stage 3 first rerun) | `28882556-e8e2-4aba-a502-40149d251d42` | `18:35:25` | 2933 | success |
| #3 (Stage 3 second rerun) | `1d52a2bb-961f-499e-ad9b-149678f2de18` | `18:44:46` | 2933 | success |

Both runs resumed from the existing checkpoint (run #2 from `07_validated`, run #3 from `08_supabase_sync` saved by run #2) and touched every existing row via PATCH.

### Integrity results — 10/10 PASS

```
T01 row count delta run2 vs run3 <1%                                   run2=2933 run3=2933 delta=0 pct=0.0000% db_total=2934   PASS
T02 distinct business_key unchanged                                    distinct=2934 expected=2934                              PASS
T03 pipeline_last_seen_at advances each run (ex-synthetic)             stale_rows=0 final_run_started=2026-04-18T18:44:46Z      PASS
T04 created_at unchanged for pre-existing rows                         checked=2933 missing=0 mismatches=[]                     PASS
T05 lock preserved (planted phone retained)                            phone='555-TEST-LOCK' lock=True                          PASS
T06 unlock snap-back to scraped phone                                  phone='(617) 576-1010' (matched original)                PASS
T07 synthetic row untouched (last_seen stale, row alive)               last_seen='2026-04-16T18:35:00Z' (pipeline did not touch) PASS
T08 zero level='error' events since stage start                        errors=0                                                 PASS
T09 no-op rerun produces no prospect_field_change events               spurious=0/0                                             PASS
T10 edit-lock audit correlation (only plant edit, no rerun overwrite)  company_phone_events_on_lock_row=1                       PASS
```

Mapping to plan bullets:
- T01 = row-count delta <1%.
- T02 = distinct business_key unchanged.
- T03 = `pipeline_last_seen_at` advances each run (synthetic row is excluded by design; it is the subject of T07).
- T04 = `created_at` unchanged on pre-existing rows (upsert, not insert).
- T05 = edit-preservation lock test.
- T06 = unlocked-overwrite snap-back.
- T07 = deleted-upstream test (pipeline non-destructive on rows it no longer discovers).
- T08 = zero error-level log entries.
- T09 = audit trigger no-op behavior on unchanged dataset.
- T10 = edit-lock/audit correlation (only the user's original plant edit shows up; no rerun overwrite).

### Teardown

`stage3_cleanup.py` restored the lock row's `company_phone` to `'(704) 423-1660'` and cleared `user_overrides`; the synthetic row was hard-deleted. The unlock row had already been snapped back by rerun #2 and needed no action. Post-cleanup DB is back to 2,933 rows with 2,933 distinct business_keys.

### Exit gate

Green. Stage 3 complete; ready for Stage 4 (nonprofit BMF enrichment).

---

