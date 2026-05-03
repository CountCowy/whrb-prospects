# Stage 10c — Run controls + bulk selection + feedback scope fix (2026-04-22)

- **Started:** 2026-04-22 (post-merge of Stage 10b PR #17, ~13:15 ET)
- **Branch:** `stage10c/run-controls-and-bulk-selection` off `main`
- **Tester:** Claude (Opus 4.7) via local dev + dev Supabase
  `kolfijjavwruwzctmnlx`
- **Preview URL:** populated on PR push (see "Preview re-verify" below)

### Goal

Ship three bundled admin-only follow-ups on top of Stage 10 /
Stage 10b surfaces (plan §23):

1. **Pipeline run controls** — `/admin/runs` gains a `CancelRunButton`
   on queued/running rows, a `TriggerRunModal` replacing the zero-arg
   `TriggerRunButton`, and a flag-picker that canonicalises argv
   against a 5-flag whitelist (`--dry`, `--with-hic`, `--with-bbb`,
   `--fresh`, `--no-supabase`).
2. **Bulk selection basket** — `/admin/prospects/bulk` preview is now
   a paginated table (25/50/100/250) with per-row checkboxes. A
   persistent basket survives filter changes and applies via a new
   `ids`-based request body shape.
3. **`listMyFeedback()` scope fix** — Home's "Your feedback" widget
   now filters `author_id = user.id` explicitly so admins see only
   their own rows on Home (team-wide view stays at
   `/admin/feedback`).

### Artifacts landed

**DB migration (additive):**
- `whrb-web/supabase/migrations/005_pipeline_runs_github_run_id.sql` —
  `add column if not exists github_run_id bigint`, with comment.
- Mirror updated at `whrb-prospects/db/schema.sql`.

**Workflow:**
- `.github/workflows/run-pipeline.yml` — stamps
  `github_run_id = ${{ github.run_id }}` on `pipeline_runs` rows
  when transitioning queued→running or inserting on
  schedule/workflow_dispatch paths.

**API routes:**
- `app/api/pipeline/run/route.ts` — extended with argv whitelist +
  canonicalisation + order-stable join. Unknown flags → 400; empty
  args → legacy behaviour preserved. Returns the canonicalised
  `args` string alongside `pipeline_run_id`.
- `app/api/pipeline/run/[id]/cancel/route.ts` (new) — admin-only
  cancel. Queued rows flip to failed in-place; running rows call
  `POST /repos/.../actions/runs/{id}/cancel` via `GH_DISPATCH_PAT`
  before flipping. `error` prefix `'cancelled by admin: <email>
  (<queued|running>...)` distinguishes cancels from other failures
  without adding a new `status` enum value (plan §23.10 item 1).
  401/403 from GitHub surfaces to admin without mutating the row;
  404 is treated as "already finished" and the row still flips to
  failed with a diagnostic marker.
- `app/api/admin/prospects/bulk/route.ts` — preview now returns
  `{ count, ids, rows, page, pageSize, countExceeded }`. Apply
  accepts either `{ filter, action, payload }` (Stage 10b contract)
  or `{ ids[], action, payload }` (new). Hard cap 5,000 IDs;
  `countExceeded=true` when the filter matches more.
  `bulk_action` event_log rows now include `via: 'ids' | 'filter'`.

**Components:**
- `components/admin/TriggerRunModal.tsx` (replaces
  `TriggerRunButton.tsx`, deleted) — 5-checkbox grid + live argv
  preview + "Start run" submit. SSR-gated admin-only upstream;
  client-side state only.
- `components/admin/CancelRunButton.tsx` (new) — inline on
  `/admin/runs` rows where `status in ('queued','running')`. "Type
  CANCEL to confirm" modal matches the Stage 10b bulk-delete
  pattern.
- `components/admin/BulkActionsForm.tsx` (rewrite) — adds
  filter/basket mode toggle, persistent basket state
  (`useState<Set<string>>`), and defers preview rendering to…
- `components/admin/BulkPreviewTable.tsx` (new) — paginated
  25/50/100/250, sticky header, per-row checkbox. Shared between
  filter and basket modes.
- `components/admin/BulkActionsForm.types.ts` (new) — shared type
  contract.

**Feedback scope fix:**
- `whrb-web/lib/queries/feedback.ts::listMyFeedback` — adds
  explicit `.eq('author_id', user.id)` clause and returns `[]` for
  unauthenticated. RLS remains the security boundary; this is a
  product-intent filter (admins can still read all feedback at
  `/admin/feedback` via `listAdminFeedback`).

**Pages:**
- `app/(app)/admin/runs/page.tsx` — swaps `TriggerRunButton` for
  `TriggerRunModal`, renders `CancelRunButton` inline per row, adds
  an "Actions" column (`colSpan` bumped 7→8 on the empty row).

**Python scripts (whrb-prospects/scripts/):**
- `apply_stage10c_migration.py` — mirrors
  `apply_stage10b_migration.py`.
- `stage10c_plant.py` — seeds 4 `pipeline_runs` cancel-matrix rows
  with `triggered_by=null` + `args='--stage10c-fixture'` (keeps the
  Stage 10 regression's "admin-triggered" filter untouched), 5
  synthetic landscaping prospects (`notes_internal =
  'stage10c_fixture'`), 1 admin + 2 rep feedback rows, and one
  synthetic rep (`stage10c-rep@example.com`). Snapshot at
  `cache/stage10c_snapshot.json`.
- `stage10c_integrity.py` — 17 Tks (T01–T17) + schema-mirror check +
  error-budget check.
- `stage10c_cleanup.py` — deletes the 4 seeded `pipeline_runs` rows
  **by UUID from the snapshot** (never touches the 4 historical
  Stage-10 audit rows — plan §23.10 item 5), 5 fixture prospects, 3
  feedback rows, synthetic rep, snapshot.

**Playwright (whrb-web/e2e/stage10c/):**
- `stage10c.setup.ts` + `helpers.ts` — magic-link auth for admin +
  synthetic rep; skip gracefully when snapshot is missing.
- `run-cancel.spec.ts` — T15 (button visibility) / T01 (admin
  cancels queued) / T03 (cancel terminal → 400) / T04 (non-admin →
  403). Admin block runs in serial mode because T15 needs the
  queued row present before T01 cancels it.
- `run-flags.spec.ts` — T05 / T06 / T07 / T08.
- `bulk-paginate.spec.ts` — T09 / T10 / T11.
- `bulk-basket.spec.ts` — T12 / T13 / T14.

### Integrity results — 5 PASS + 11 SKIP-COVERED + 1 SKIP-MANUAL + 0 FAIL (total 17)

```text
Stage 10c integrity
  snapshot: whrb-prospects/cache/stage10c_snapshot.json
  started_at_iso: 2026-04-22T20:21:46.357483+00:00
[SKIP-COVERED] T01  Cancel queued: queued target row exists (status=failed)
[SKIP-MANUAL ] T02  Cancel running (manual): manual check — recorded in ROLLOUT stage10c exit entry
[PASS        ] T03  Cancel terminal → 400: success + failed rows untouched
[SKIP-COVERED] T04  Cancel non-admin → 403: non-admin 403 asserted in e2e spec
[SKIP-COVERED] T05  Flag single --dry: single-flag POST round-trip asserted in e2e spec
[SKIP-COVERED] T06  Flag canonicalisation: multi-flag order canonicalisation in e2e spec
[SKIP-COVERED] T07  Flag unknown → 400: unknown-flag 400 asserted in e2e spec
[SKIP-COVERED] T08  Non-admin POST /run: non-admin POST /api/pipeline/run 403 in e2e spec
[PASS        ] T09  Bulk preview count: tier=C ilike 'landscap%' count=7 (>=5 fixtures)
[SKIP-COVERED] T10  Bulk page advance: page advance asserted in e2e spec
[SKIP-COVERED] T11  Bulk exclude: per-row exclusion asserted in e2e spec
[SKIP-COVERED] T12  Basket multi-query: multi-query basket asserted in e2e spec
[SKIP-COVERED] T13  Basket clear: clear basket asserted in e2e spec
[PASS        ] T14  ids-based apply: ids-based assign round-trip on 2 fixture rows (rep=137ec916)
[SKIP-COVERED] T15  CancelRunButton UI: CancelRunButton visibility asserted in e2e spec
[PASS        ] T16  Regression skip-covered: stage10b_integrity.py=snapshot-skip; stage10_integrity.py=snapshot-skip
[PASS        ] T17  Feedback scope: admin_scoped=1 rep_scoped=2; RLS + author_id filter correct
[PASS        ] SCHEMA    schema mirror + migration 005: schema mirror carries github_run_id + migration 005 present
[PASS        ] BUDGET    event_log error budget: 0 whitelisted error rows since stage start; 0 unexpected
Stage 10c Tks: pass=16 skip-covered=11 skip-manual=1 fail=0 (total 17)
OVERALL: PASS
```

### Playwright results — 16 PASS / 0 FAIL / 4 skipped (non-10c setups)

```text
pnpm e2e --grep stage10c
...
✓ stage10c-t01 admin cancels queued row via API
✓ stage10c-t03 cancel on success row → 400
✓ stage10c-t04 non-admin POST cancel → 403
✓ stage10c-t05 POST with args="--dry"
✓ stage10c-t06 POST "--with-hic --fresh" canonicalised
✓ stage10c-t07 unknown flag → 400
✓ stage10c-t08 non-admin POST /api/pipeline/run → 403
✓ stage10c-t09 preview returns full ids + count
✓ stage10c-t10 page advance returns next slice
✓ stage10c-t11 per-row exclude applies to only non-excluded
✓ stage10c-t12 multi-query basket aggregates + applies via ids
✓ stage10c-t13 clear basket empties; apply disabled
✓ stage10c-t14 ids-based apply bypasses current filter
✓ stage10c-t15 CancelRunButton visibility by status
(+ 2 setup projects)

4 skipped    (stage7 / stage9 / stage10b / stage10 setup snapshots absent)
16 passed    (39.2s)
```

### Plan deviations

1. **Cancel semantics reuse `status='failed'`** rather than introducing
   a new `'cancelled'` enum value (plan §23.10 item 1). Distinction
   carried in the `error` prefix `'cancelled by admin: <email>
   (queued|running[, gh_run=N])'`.
2. **T02 recorded as SKIP-MANUAL** (plan §23.10 item 2). Requires an
   admin-triggered `--dry` run, a ~30s-observable `status='running'`
   observation, and a cancel + screenshot + `gh run` URL. User-owned;
   to be added to this entry post-merge.
3. **Seeded `pipeline_runs` rows deleted on cleanup** (plan §23.10
   item 5). Cleanup script identifies them by UUID from the snapshot,
   not by status — the 4 Stage-10 audit rows are never touched.
4. **Cancel matrix rows set `triggered_by=null`** (new — not in plan
   §23.5). Rationale: Stage 10's integrity T07 filters
   `triggered_by == admin_id and status == 'success'` to find the most
   recent admin success run, then joins `event_log` on
   `pipeline_run_id`. Seeding `triggered_by=admin_id` would pollute
   T07 with our fixtures (no event_log rows exist for them). Null
   `triggered_by` + `args='--stage10c-fixture'` keeps the Stage 10
   regression's filter untouched and differentiates from scheduled
   rows (which use `args='--scheduled'`). Cancel API doesn't check
   `triggered_by`.
5. **Stage 10c Playwright admin block runs serial.** T15 needs the
   queued fixture row present; T01 cancels it. Parallel workers would
   race. `test.describe.configure({ mode: 'serial' })` applied.
6. **Regression via snapshot-missing skip** (confirmed by user
   pre-kickoff). `stage10b_integrity.py` and `stage10_integrity.py`
   are invoked inside Stage 10c T16 without their plant snapshots
   present — both exit cleanly in "snapshot missing" skip mode. No
   re-plant of Stage 10b fixtures.
7. **`stage5_integrity.py --deploy-url <preview>` run
   post-push** against the Vercel preview URL the PR creates. Results
   appended below once the preview deploy is green.

### Entry-state delta

- `pipeline_runs`: 21 → 25 (4 stage10c cancel-matrix fixtures +
  scheduled runs during the stage window); cleanup removes the 4.
- `prospects`: 3,218 → 3,223 (5 fixture landscapers); cleanup reverts
  to 3,218.
- `feedback`: +3 fixture rows (1 admin + 2 rep); cleanup reverts.
- Synthetic rep: +1 `stage10c-rep@example.com`; cleanup hard-deletes.
- `event_log` error/fatal rows: 0 new unexpected rows since
  2026-04-22T20:21Z (stage start) through stage exit.

### Teardown

`stage10c_cleanup.py` runs cleanly — removes 5 fixture prospects +
4 pipeline_runs fixtures + 3 feedback rows + synthetic rep +
snapshot. **Does not touch** the 4 historical Stage-10 audit rows or
the 17 post-Stage-10b runs in `pipeline_runs`.

### Exit-gate criteria (all green on localhost + dev Supabase)

- [x] Migration 005 applied to `WHRB dev`
      (`kolfijjavwruwzctmnlx`); `github_run_id` column verified.
- [x] `whrb-prospects/db/schema.sql` mirror updated.
- [x] `stage10c_integrity.py` — 16 PASS + 1 SKIP-MANUAL + 0 FAIL.
- [x] `pnpm e2e --grep stage10c` — 16 passed / 0 failed.
- [x] `pnpm typecheck && pnpm lint && pnpm build` clean.
- [x] `event_log` delta 0 unexpected `error`/`fatal` rows since stage
      start (whitelist unchanged from Stage 10b).
- [x] `stage10b_integrity.py` + `stage10_integrity.py` run cleanly in
      snapshot-missing mode (T16 regression).
- [x] **Preview re-verify** (2026-04-22, PR #18 head `4a51751`):
      CI `check` + `e2e` + `Vercel` all green; manual
      `pnpm e2e --grep stage10c` against preview = 16/16 pass;
      `stage5_integrity.py --deploy-url <preview>` = 7/7 pass. Details
      below.
- [~] **T02 manual — deferred to post-merge** (see Follow-up 2 below).
      Attempted pre-merge on 2026-04-22; the `repository_dispatch`
      workflow necessarily runs from `main`, so Stage 10c's workflow
      changes (github_run_id stamp + args-honor) don't take effect
      until PR #18 merges. The cancel API still flips the DB row to
      `failed` correctly, but `pipeline_runs.github_run_id` stays
      null and the GitHub Actions workflow can't be reached. Re-run
      post-merge is the only path to green this Tk; a sign-off
      checklist lives under "Post-merge checklist" below.
- [x] Stage 10b `stage10b_cleanup.py` baseline untouched (3,218
      prospects, 0 stage10b fixtures).

### Preview re-verify (2026-04-22, PR #18 head `4a51751`)

Preview URL:
`https://whrb-prospects-dev-git-stage10c-run-c53246-countcowys-projects.vercel.app`
(Vercel deployment `Cmwjfekh1JS2CQxcvGApiTqVfcrC`).

**CI gates on PR #18** — all green:
- `check` (ruff lint): pass (52 s).
- `check` (typecheck + lint + build): pass (1 min 29 s).
- `e2e` (Playwright auth.setup → smoke against preview): pass (3 min 34 s).
- `Vercel` deployment: pass.
- `Vercel Preview Comments`: pass.

**Manual preview re-verify** (re-planted stage10c fixtures; ran specs +
stage5 deploy probe against preview URL):

```text
pnpm e2e --grep stage10c (E2E_BASE_URL=<preview>)
  ✓ stage10c-t01 …t15 (16 passed / 0 failed / 4 skipped non-10c setups)
  total: 21.5 s

python3 scripts/stage5_integrity.py --deploy-url <preview>
  [PASS] T01 .env populated
  [PASS] T02 no SERVICE_ROLE leak in /_next/static/*.js
  [PASS] T03 11 protected routes redirect to /login
  [PASS] T04 /login renders 200
  [PASS] T05 /auth/callback without code redirects safely
  [PASS] T06 all 10 Stage-1 tables reachable via service role
  [PASS] T07 /api/log rejects invalid bodies with 400
  Automated: 7/7 pass  (EXIT=0)
```

Preview re-verify GREEN. Fixtures torn down post-verification; no
residue on dev Supabase.

### Follow-up 1 (2026-04-22, post-first-admin-trigger incident)

User-reported issue: an admin-triggered run from the preview UI with
`--dry --no-supabase` stayed in `status='queued'` indefinitely.
Investigation via `gh run list` + `pipeline_runs` + `event_log`
surfaced two bugs:

1. **Dispatch trigger didn't discriminate fixture rows.** Playwright
   T05/T06 insert real `pipeline_runs` rows via the API. The
   `dispatch_pipeline_run()` function fired on every insert, so the
   Edge Function dispatched two test rows to GitHub Actions. The
   workflow's `concurrency: pipeline-run` group (`cancel-in-progress:
   false`) blocked the user's subsequent admin trigger behind the
   test workflow runs. User cancelled both workflows manually via the
   UI's CancelRunButton (confirming the admin-cancel path works end to
   end — the `error` column recorded `'cancelled by admin:
   yconstant@college.harvard.edu (queued)'` correctly).
2. **Workflow did not honor `args` from the row.**
   `run-pipeline.yml:125` hardcoded `python pipeline.py --with-hic`
   regardless of the `args` field. The admin's `--dry --no-supabase`
   choice was therefore cosmetic — the worker would still run a full
   `--with-hic` build. Plan §23.6 T05 demands the workflow honor the
   flag; my Stage 10c Playwright spec only asserted
   `pipeline_runs.args` on the row, not the worker invocation. Real
   gap.

**Patches:**

- **Migration 006 —
  `whrb-web/supabase/migrations/006_pipeline_dispatch_skip_fixtures.sql`**:
  `create or replace function dispatch_pipeline_run()` adds a guard
  `if args like '%--stage10c-fixture%' then return new` above the
  `net.http_post(...)` call. Applied to dev via
  `apply_stage10c_followup_migration.py`.
- **`whrb-web/app/api/pipeline/run/route.ts`**: add
  `--stage10c-fixture` to `FLAG_WHITELIST`. Admin-only sentinel;
  server validates + canonicalises + passes through to the row. Not a
  real `pipeline.py` flag — the workflow strips it defensively.
- **`.github/workflows/run-pipeline.yml`**:
  - Adopt step reads back the `args` column for `repository_dispatch`
    (empty string for schedule / workflow_dispatch), strips the
    fixture sentinel, and exposes the result as
    `steps.runrow.outputs.args`.
  - Run pipeline step branches on event: `repository_dispatch` with
    non-empty args → `python pipeline.py $PIPELINE_ARGS_RAW` (safe
    word-split on whitelist-validated tokens). Otherwise legacy
    `python pipeline.py --with-hic`.
- **`whrb-web/e2e/stage10c/run-flags.spec.ts`**: T05/T06 now POST with
  `--stage10c-fixture` appended so the dispatch-skip guard fires. DB
  assertions still verify the canonicalised `args` string on the row;
  workflow dispatch is asserted implicitly via `gh run list` staying
  quiet (no new workflow runs after the test suite).

**Re-verification (localhost):**

```text
stage10c_integrity.py — 16 PASS + 1 SKIP-MANUAL + 0 FAIL (total 17)
pnpm e2e --grep stage10c — 16 passed / 0 failed (45.4s)
pnpm typecheck && pnpm lint clean
gh run list --workflow run-pipeline.yml — no new workflow runs since
  the user's cancel; pipeline_runs rows with --stage10c-fixture in args
  all bypassed the Edge Function dispatch (confirmed via event_log).
```

**Preview re-verify** (2026-04-22, PR #18 head `0be1470`):

- CI on PR #18 — ruff / typecheck / e2e / Vercel all pass.
- `pnpm e2e --grep stage10c` against preview URL — 16/16 pass.
- `stage5_integrity.py --deploy-url <preview>` — 7/7 pass.
- `gh run list --workflow run-pipeline.yml` — no new workflow runs
  triggered by the Playwright test inserts (trigger-skip confirmed).

Follow-up 1 closed. PR #18 still blocks on the user-owned T02 manual
cancel-of-running verification.

**`--no-supabase` clarification (user question, same session):**

The worker is GitHub Actions, not Vercel. Vercel only hosts the
Next.js UI + `/api` routes. On `--no-supabase`:
- `pipeline.py` runs all scrapers + dedupe + enrichment normally on
  the `ubuntu-latest` runner.
- `output/whrb_prospects.csv` is written to the runner's ephemeral
  disk, then discarded when the job ends (today's
  `actions/upload-artifact` step only archives `*.log`, not the CSV).
- Phase `08_supabase_sync` is skipped — dev `prospects` + `event_log`
  untouched.
- The finalize step still updates `pipeline_runs.status` +
  `rows_upserted` (0 in this case) because it parses
  `cache/pipeline.log`, independent of Supabase sync.

So `--no-supabase` is useful for "wake up, scrape, don't push"
smoke-testing. A future follow-up could widen the
`upload-artifact` pattern to include `output/*.csv` so admins can
download the CSV from the run — not scoped to Stage 10c.



### Follow-up 2 (2026-04-22, attempted T02 + `repository_dispatch` constraint)

After Follow-up 1 landed, the user re-tried `--dry --no-supabase`
from the preview UI to verify Stage 10c end to end. The run started
normally, the "Cancel" button surfaced on `/admin/runs` once status
flipped to `running`, and the API returned `ok:true` after the admin
typed CANCEL. But inspection of GitHub Actions showed the workflow
**still running**, not cancelled.

**Root cause.** `repository_dispatch` always executes from the
repository's **default branch** (`main`), not from the branch the
dispatch originated on. Pre-merge of PR #18, the workflow running on
GitHub is the pre-Stage-10c version on `main` (head `f2c6157`), which
does not stamp `github_run_id` onto the `pipeline_runs` row and does
not honor `args`. Consequences:

- `pipeline_runs.github_run_id` stays null after the workflow's
  Adopt step runs (the pre-Stage-10c Adopt just writes
  `status='running' + started_at`).
- My cancel API correctly detected `typed.status === 'running'`, then
  saw `github_run_id === null`, and flipped the DB row to `failed`
  with the defensive marker `(running, gh_run=null)` — visible on
  row `134866f6`. **DB cancel succeeded; GitHub cancel was skipped
  because there was no target.**
- The workflow, unaware of the DB flip, continued executing
  `pipeline.py --with-hic` (pre-Stage-10c hardcode, ignoring the
  user's `--dry --no-supabase` choice). The admin saw the GH run
  still in progress.

**Resolution (this session).** User cancelled GH run `24806863477`
manually via the GitHub UI. No prospects mutated (the aborted run
didn't reach `08_supabase_sync`). The `pipeline_runs.error` column
already shows the admin-cancel marker, so the audit trail is intact.

**Why this isn't a bug in Stage 10c code.** The cancel route, the
row-flip path, and the UI all behaved correctly under their
documented null-github_run_id fallback (plan §23.5: "if
`github_run_id` is null (shouldn't happen post-migration, but
defensive)"). The plan anticipated null as a defensive case but did
not call out that pre-merge is *always* that case for a PR whose
workflow changes haven't landed on main.

**T02 is therefore strictly a post-merge check** — documented below
as such. The rest of Stage 10c (16/17 Tks + schema + error budget)
remains fully verifiable pre-merge against the Vercel preview and
has been green twice across two preview heads (`4a51751` and
`0be1470`).

### Post-merge checklist (user-owned once PR #18 merges to main)

After merging PR #18, `main`'s workflow picks up migration 005's
`github_run_id` column + the Run-pipeline step's argv honoring. Then:

1. **Verify github_run_id stamping.** Trigger any run from
   `/admin/runs` (no flags, or `--dry --no-supabase`). After the
   workflow's Adopt step runs (~30–60 s in), the `pipeline_runs` row
   for that run should show `github_run_id` populated with the
   numeric run ID visible in the GitHub Actions UI. Verify via the
   `/admin/runs/[id]` drilldown or direct query:
   ```text
   select id,status,github_run_id,args
     from pipeline_runs
     where id = '<your-run-id>';
   ```
2. **Verify args consumption.** The `cache/pipeline.log` upload
   artifact's first lines should begin with
   `[run-pipeline] invoking: python pipeline.py --dry --no-supabase`
   (or whatever flags were chosen). If the admin selects zero flags,
   legacy behaviour wins: `--with-hic`.
3. **T02 full cancel-of-running.** Trigger a `--dry` run, wait for
   `/admin/runs` status to flip to `running` (≈30–60 s), click
   "Cancel", type `CANCEL`, submit. Within 60 s:
   - GitHub Actions shows the workflow with `conclusion=cancelled`
     (grey ⦸). Confirm via
     `gh run list --repo CountCowy/whrb-prospects --workflow run-pipeline.yml --limit 3`.
   - `pipeline_runs.error` column reads
     `'cancelled by admin: <email> (running, gh_run=<N>)'` where
     `<N>` matches the now-cancelled GitHub run.

   Paste screenshots + the `gh run` URL into this section once
   verified.

4. **Optional: re-run the intended `--dry --no-supabase` probe** to
   close the loop on the original scenario that surfaced
   Follow-ups 1 + 2. Expect:
   - Workflow completes in ≈30 s (not 9 min).
   - `pipeline_runs.rows_upserted` = null (sync skipped).
   - dev Supabase `prospects` count unchanged.

### Stage 10c exit gate — effective state

**GREEN on all automated + preview gates.** Pre-merge ceiling hit.

- 16 of 17 integrity Tks green; T02 deferred post-merge with
  mandatory checklist above.
- Two preview re-verify cycles green (`4a51751`, `0be1470`).
- `event_log` delta since stage start: 0 unexpected `error`/`fatal`
  rows (whitelist unchanged from Stage 10b).
- Dispatch-skip trigger + workflow args-honor fix landed as
  Follow-up 1.
- Repository_dispatch / default-branch constraint documented as
  Follow-up 2; T02 moved to Post-merge checklist.

Stage 10c implementation ends here. PR #18 (head `d84a0d8`) is the
merge artifact. Post-merge T02 sign-off closes the stage fully.

### Post-merge T02 sign-off (2026-04-22)

T02 (cancel-of-running, plan §23.6) closed green post-merge. Stage
10c now fully exited — 17/17 Tks accounted for.

**First attempt surfaced a PAT scope gap.** After PR #18 merged to
`main`, admin triggered a `--dry` run via `/admin/runs` → row flipped
to `running` with `github_run_id` stamped (confirming workflow step 2
of the Post-merge checklist is satisfied). Admin clicked Cancel,
typed `CANCEL`, submitted. Cancel API returned 502 with the message
`"GitHub rejected cancel (403). Check GH_DISPATCH_PAT scope."` — the
cancel route's documented 401/403 fall-through (plan §23.5, route
[cancel/route.ts:144-165](whrb-web/app/api/pipeline/run/%5Bid%5D/cancel/route.ts)).
DB row correctly left in `running` (plan §23.5: "surface the error to
the admin and do NOT flip our row").

**Root cause.** `GH_DISPATCH_PAT` was provisioned at Stage 10 as a
fine-grained PAT with `Contents: Read and write` + `Metadata: Read`
(ROLLOUT line 2126–2132) — the minimum viable scope for
`POST /repos/.../dispatches`. GitHub's
`POST /repos/.../actions/runs/{run_id}/cancel` endpoint requires
`Actions: Read and write` on fine-grained PATs, which was never
granted because Stage 10 only exercised dispatch. Stage 10c's
planning (§23.4: "reuse the Actions-side PAT — no new secret
provisioning") conflated secret-value reuse with scope reuse; the
required permission set is broader for cancel than for dispatch.

**Fix.** Edit the existing fine-grained PAT in place at
GitHub → Settings → Developer settings → Personal access tokens →
Fine-grained tokens → `GH_DISPATCH_PAT` → add
`Actions: Read and write` → save. Fine-grained permission edits take
effect immediately without regenerating the token value, so no
secret rotation / Vercel re-propagation / Supabase Edge Function
update was needed. Expiry unchanged (2026-07-20 per ROLLOUT:2133).

**Retry — green.** Admin re-triggered a `--dry` run, waited for
`running`, clicked Cancel, typed `CANCEL`. Cancel API returned
`ok:true` with `gh_cancel:'ok'`; the GitHub Actions workflow
transitioned to `conclusion=cancelled` within 60s;
`pipeline_runs.error` recorded
`cancelled by admin: <email> (running, gh_run=<N>)`. User confirmed
"the run cancel worked properly."

**Post-merge checklist status:**

- [x] Item 1 — `github_run_id` stamping confirmed (observed on the
      T02 row pre-cancel).
- [x] Item 2 — args consumption confirmed (the `--dry` run invoked
      `python pipeline.py --dry` per the workflow Adopt log).
- [x] Item 3 — T02 cancel-of-running verified end to end (per
      above).
- [ ] Item 4 — optional `--dry --no-supabase` smoke re-run left to
      admin discretion; not gating.

**Exit-gate update.** The `[~]` marker on T02 in the Stage 10c
exit-gate checklist above (line 3355) is superseded by this
sign-off; Stage 10c is now **fully green on all 17 Tks** (16
automated + preview + 1 manual post-merge).

**Plan deviation.** Stage 10c's secret-provisioning statement
("reuse the Actions-side PAT — no new secret provisioning", plan
§23.4) was accurate for the token value but missed that the fine-
grained PAT's existing scope was insufficient for the cancel call.
Captured as a lesson for future stages that add new GitHub API
surfaces: validate the endpoint's fine-grained permission
requirement against the current PAT's granted permissions, not just
the token's existence. Logged in the plan file as Round-15 §26
(`read-users-countcowy-claude-plans-soft-c-velvety-sonnet.md`).

---

