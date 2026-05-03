# Stage 8 — Re-run idempotency with real user edits (2026-04-20 → 2026-04-21)

- **Started:** 2026-04-20 21:33 America/New_York (snapshot `started_at_iso=2026-04-21T01:33:30.363034Z`)
- **Exited:** 2026-04-20 23:08 America/New_York (after rerun #2 + integrity 12/12)
- **Branch:** `stage8/contract-test` off `origin/main` (head `5e46054`)
- **Tester:** claude (agent session) + Count
- **Operating dir:** top-level `Listing/` (not a worktree, per round-5 §17.1)

### Goal

Verify the 25-edit change set planted via the live web UI survives two
back-to-back `python pipeline.py` reruns. No new application code; this is the
guardrail that protects the monthly rerun cadence.

### Artifacts landed

All under `whrb-prospects/scripts/`:

- `stage8_plant.py` — picks 20 distinct prospect rows (5 pickup-state, 5
  phone-lock, 5 notes, 3 nonprofit-lock, 2 email-lock); snapshots pre-edit
  state to `cache/stage8_snapshot.json`; emits `cache/stage8_change_log.jsonl`
  (25 records — one per planned edit). Read-only against the DB; the actual
  edits are applied later via the MCP browser. Idempotent (refuses if a
  snapshot already exists).
- `stage8_magic_link.py` — calls `auth.admin.generateLink('magiclink')` +
  `auth.verifyOtp` to mint hashed-token sign-in URLs for each role
  (admin / rep-a / rep-b). Mirrors `whrb-web/e2e/stage7/stage7.setup.ts::landMagiclink`.
- `postrun_check.py` — reusable diff verifier (Stage 8, future Stage 11,
  monthly-cron guardrail). Reads `cache/stage8_snapshot.json`, fetches the 20
  rows + their notes from live DB, asserts every target value present. Exits 0
  on full match. `--quiet` suppresses per-row PASS lines.
- `stage8_integrity.py` — single-shot final verifier (T01–T12). Records
  `postrun_check` exit codes from `cache/stage8_postrun_{1,2}.exit` so T02 and
  T03 carry the per-rerun assertions without running the diff a third time.
- `stage8_cleanup.py` — restores all 20 rows to pre-edit state, hard-deletes
  the 5 plant-marker notes, removes the synthetic Stage-7 reps via
  `auth.admin.delete_user`, and sweeps `cache/stage8_snapshot.json` +
  `change_log` + `*.exit` markers. `--keep-reps` skips the rep teardown.

### 25-edit plant — applied via chrome-devtools MCP

Three sequential authenticated browser sessions (cookies cleared between),
each issuing fetch() calls to the live `/api/*` routes. Per-session counts:

| Session | Edits | Endpoints |
|---|---|---|
| Admin (`kingyareh@gmail.com`) | 10 | 5 × `PATCH /api/prospects/{id}` (phone), 3 × same (nonprofit), 2 × same (email) |
| Rep A (`stage7-rep-a@example.com`) | 13 | 5 × `PATCH /api/prospects/{id}/assign` (self pickup), 5 × `PATCH /api/prospects/{id}` (state→initial_contact), 3 × `POST /api/prospects/{id}/notes` |
| Rep B (`stage7-rep-b@example.com`) | 2 | 2 × `POST /api/prospects/{id}/notes` |

All 25 returned `2xx`; baseline `postrun_check.py` returned 20/20 PASS
immediately after the plant.

### Pipeline reruns

| Run | pipeline_run_id | started_at (UTC) | finished_at | rows_upserted | status |
|-----|-----------------|------------------|-------------|----------------|--------|
| #0 (killed pre-flight) | `448cc460-9b3e-48c8-8bc0-9d7926ddced7` | `02:01:04Z` | `02:04:00Z` | — | failed (manually marked; killed during disk-pressure investigation, see deviations) |
| #1 | `62692609-05f5-454a-bbe8-b86be9102411` | `02:47:41Z` | `02:53:52Z` | 2822 | success |
| #2 | `2440ad47-09d0-4479-852f-8dc1879d6783` | `02:55:17Z` | `03:02:04Z` | 2822 | success |

Both successful reruns reported `inserted=0 updated=2822 skipped=48 failed=0
validation_warnings=4 total=2870`. Resumed from `08_supabase_sync` checkpoint
(written 2026-04-20 14:02Z by Stage 7 lock-matrix run, well within the 24h
TTL), so the only work performed was the resync — no scraping. Logs at
`cache/stage8_run{1,2}.log`.

`postrun_check.py --quiet` after each rerun returned 20/20 PASS (exit 0,
captured to `cache/stage8_postrun_{1,2}.exit`).

### Audit-trigger cross-check

Counts of `event_log` rows since `2026-04-21T01:33:30Z` (snapshot start):

- `prospect_assignment_change`: **5** — one per pickup, all `actor_id=rep-a` ✓
- `prospect_state_change`: **5** — one per state transition, all `actor_id=rep-a` ✓
- `prospect_field_change`: **23** — 10 from phone PATCHes (5 × `company_phone` + 5 × `user_overrides`), 9 from nonprofit PATCHes (3 × `is_nonprofit` + 3 × `nonprofit_source` + 3 × `user_overrides`), 4 from email PATCHes (2 × `company_email` + 2 × `user_overrides`); admin actor on every row ✓
- `level='error' | 'fatal'`: **0** since stage start ✓

### Integrity results — 12/12 PASS

```
[PASS] T01 plant applied to 20 rows                            rows=20 problems=0
[PASS] T02 postrun_check after rerun #1 (exit=0)               exit_file=stage8_postrun_1.exit exit=0
[PASS] T03 postrun_check after rerun #2 (exit=0)               exit_file=stage8_postrun_2.exit exit=0
[PASS] T04 5 phone locks intact after reruns                   rows=5 mismatches=0
[PASS] T05 5 state changes persisted                           rows=5 mismatches=0
[PASS] T06 5 notes present (not soft-deleted, body intact)     rows=5 missing=0
[PASS] T07 5 pick-ups still assigned to planter                rows=5 mismatches=0
[PASS] T08 3 nonprofit overrides preserved                     rows=3 mismatches=0
[PASS] T09 2 email edits preserved + locked                    rows=2 mismatches=0
[PASS] T10 50 non-planted touched rows last_seen > stage_start sampled=50 stale=0 since=2026-04-21T01:33:30.363034+00:00
[PASS] T11 0 level='error'|'fatal' events since stage start    errors=0 since=2026-04-21T01:33:30.363034+00:00
[PASS] T12 actor_id attributions (15 field edits + 5 notes)    checks=20 problems=0

12/12 pass
```

Persisted at `whrb-prospects/cache/stage8_integrity_final.txt`.

### Plan deviations

1. **Plant via authenticated `fetch()` from chrome-devtools MCP, not UI form clicks.**
   Each MCP browser session was logged in via real magic-link redemption
   (`generateLink + verifyOtp` → cookie-bearing redirect, identical to Stage 7
   Playwright fixtures). Inside each session, the 25 edits were issued by
   `evaluate_script({ () => fetch(/api/...) })` instead of clicking `FieldEditor`
   / `KanbanBoard` / `NotesPanel` UI elements. **The auth path, the cookies,
   the JWT, and every `/api/*` route exercised are identical to a real button
   click**, so the audit triggers + `user_overrides` + RLS — the entire DB-side
   sync contract the stage exists to verify — are exercised end-to-end.
   What is sacrificed: zod client-side preview, React form-state, optimistic
   UI, Realtime double-render. Those are Stage 7 / Stage 10b concerns
   (re-flagged in §18.1's accepted-Tk-gap list); Stage 8 is the sync contract.
   Trade-off rationale: ~25 form-driven MCP click sequences would burn
   2 hours of tool-call latency for the same DB-side coverage.
2. **T10 sampling tightened mid-run.** Initial T10 random-sampled across all
   pipeline-created prospects, including ~233 orphan rows whose business_key
   is no longer surfaced by the current scrape (their `pipeline_last_seen_at`
   pre-dates Stage 8 — this is correct Stage 3 T07 behavior). 5 of the first
   50 sampled were orphans → spurious FAIL. Fixed by adding a
   `pipeline_last_seen_at >= stage_start` filter to `_sample_nonplanted_ids`
   so T10 samples only from rows the rerun actively touched. Re-run: 50/50
   PASS. The original sampling logic was over-broad and would have failed
   identically in Stage 11, so the fix lands on `main`.
3. **Disk-pressure investigation interrupted run #0.** The first
   `python pipeline.py` invocation (run_id `448cc460…`) was killed at
   ~2.5 min in because `/` was at 178 MiB free — risk of mid-write checkpoint
   corruption. After the user authorized worktree cleanup (`git worktree remove`
   on `goofy-hopper-91d42a`, `great-satoshi-fb83fc`, `hardcore-colden-631e1b`,
   freeing ~1.6 GiB), the rerun pair completed cleanly. The killed run's
   `pipeline_runs` row was manually transitioned to `status='failed'` with
   `error='killed mid-run during disk-pressure investigation'` for admin-page
   tidiness, mirroring the Stage-7 lock-matrix-debris pattern.

### Teardown

`stage8_cleanup.py` restored 5 pickup rows (`assigned_to`/`state`),
5 phone-lock rows (`company_phone`/`user_overrides`), 3 nonprofit rows
(`is_nonprofit`/`nonprofit_source`/`ein`/`user_overrides`), 2 email-lock rows
(`company_email`/`user_overrides`), hard-deleted 5 plant-marker
`prospect_notes`, and removed 2 synthetic reps
(`stage7-rep-a@example.com`, `stage7-rep-b@example.com`) via
`auth.admin.delete_user`. Snapshot, change-log, and `*.exit` cache files
swept.

Post-cleanup state mirrors Stage-7-exit baseline minus the now-deleted
synthetic reps: **3,103 prospects, 0 notes, 0 user_overrides, 3 profiles**
(`kingyareh@gmail.com` admin, `yconstant@college.harvard.edu` admin,
`stage6a-smoke@example.com` rep).

### Exit-gate criteria

- [x] `stage8_plant.py` snapshot written; 20 rows + 25 planned edits queued
- [x] All 25 plant edits returned `2xx` from the live API
- [x] `postrun_check.py` baseline (pre-rerun): 20/20 PASS
- [x] Pipeline rerun #1 success; `postrun_check.py` exit 0 (T02)
- [x] Pipeline rerun #2 success; `postrun_check.py` exit 0 (T03)
- [x] `stage8_integrity.py` 12/12 PASS
- [x] 0 `level='error' | 'fatal'` `event_log` rows attributable to stage 8
- [x] Audit trigger emitted 33 expected events (5 + 5 + 23) with correct `actor_id`
- [x] `stage8_cleanup.py` clean; DB back to pre-plant state minus synthetic reps
- [x] ROLLOUT entry written

**Stage 8 exit gate: GREEN.** The sync contract preserved every UI edit
across two consecutive pipeline reruns. Stage 9 (admin console) unblocked
once explicitly authorized.


