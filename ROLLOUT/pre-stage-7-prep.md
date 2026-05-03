# Pre-Stage-7 prep (2026-04-20, post-Stage-6)

Captured per the companion plan's §16 round-3 clarifications. Logged here so the Stage 7
entry state is explicit. Nothing below has been executed yet — it records the agreed-upon
entry plan.

### Branch + workflow

- **Stage 6 PR** ([#7](https://github.com/CountCowy/whrb-prospects/pull/7)) merged to `main`
  at `7a6035f`.
- **Stage 7 branch:** `stage7/editing-and-assignment` forks from `origin/main` at `7a6035f`
  in the top-level `Listing/` checkout (not from a worktree). Matches the Stage-6 policy
  (§16.1 of the companion plan; §2 decision 1 of the original plan).
- **Commit cadence:** one consolidated commit once all 24 Stage-7 integrity checks are
  green.
- **PR:** open `stage7/editing-and-assignment` → `main` at exit; wait for user merge.

### Preflight

- Accept Stage 6 exit record as the trusted baseline (same tolerance as Stage 3 → Stage 4
  transition). No fresh re-run of `stage6_integrity.py` or the full Playwright suite before
  implementation begins — Stage 6 teardown removed the fixtures those checks depend on.
- **Live sanity check before planting**: `stage7_plant.py` must first verify `event_log` has
  0 rows with `level in ('error','fatal')` and `created_at > '2026-04-20T04:45Z'` (Stage 6
  exit). If any error rows surface, halt and surface the delta.

### Deps + tooling

- **New npm deps (in `whrb-web/`):** `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`
  (kanban drag-drop). `zod`, `@tanstack/react-table`, `lucide-react`, `date-fns-tz`, `sonner`
  all already present from Stage 6.
- **No new Python deps.**

### Security additions (plan deviation — defense in depth)

- **New migration `whrb-web/supabase/migrations/001_prospect_update_guard.sql`** ships with
  Stage 7:
  1. `BEFORE UPDATE` trigger on `public.prospects` enforcing column-level auth at the DB.
     Admin and assignee may update any scraped column; every other authenticated user may
     only change `assigned_to` + `assigned_at`.
  2. Admin-only `INSERT` policy on `public.prospects` (replaces the looser
     `auth.uid() is not null` allowance for INSERT).
- **Rationale:** the browser Supabase client uses the anon key + user JWT. Under current
  `auth.uid() is not null` UPDATE policy, any authenticated rep could bypass the API route
  and call `supabase.from('prospects').update({...})` directly. The DB-level column-auth
  trigger is the missing second line of defense. Corresponding RLS tightening on INSERT
  closes the same gap for the "+ Add prospect" admin guard.
- **T22 extension**: the existing assertion ("direct anon `.update()` on another row →
  empty response (RLS)") is upgraded to a real guarantee. Add a negative case: a rep
  attempting `supabase.from('prospects').update({ tier: 'A' })` on a prospect they do not
  own must receive 0 updated rows, even when the API is bypassed.

### DELETE scope

- **No `DELETE /api/prospects/[id]`** route in Stage 7 (tightens plan §5.4). Per-row delete
  is deferred entirely; bulk delete lands in Stage 10b.

### 15-field lock matrix (locked)

Intersection of the `audit_prospect_change` tracked set ∩ `SCRAPED_FIELDS` is 12 names.
Extended with 3 high-value non-audit fields to hit the plan's 15.

| # | Field | Audit-tracked? | UI lock icon? |
|---|-------|----------------|---------------|
| 1  | `tier`              | ✓ | ✓ |
| 2  | `company_name`      | ✓ | ✓ |
| 3  | `company_phone`     | ✓ | ✓ |
| 4  | `company_email`     | ✓ | ✓ |
| 5  | `contact_name`      | ✓ | ✓ |
| 6  | `contact_email`     | ✓ | ✓ |
| 7  | `contact_phone`     | ✓ | ✓ |
| 8  | `website`           | ✓ | ✓ |
| 9  | `is_nonprofit`      | ✓ | ✓ (composite; locks `nonprofit_source` + `ein`) |
| 10 | `nonprofit_source`  | ✓ | — (covered by composite) |
| 11 | `ein`               | ✓ | — (covered by composite) |
| 12 | `priority_score`    | ✓ | **NO icon** (derived value) |
| 13 | `address`           | ✗ | ✓ |
| 14 | `zip`               | ✗ | ✓ |
| 15 | `category`          | ✗ | ✓ |

`priority_score` is lockable programmatically via `user_overrides["priority_score"]`
(round-7 contract) but does **not** get a lock icon — it's a derived value (weights +
chamber bonus + log-scaled review count) and exposing it as user-editable would confuse
reps. `stage7_lock_matrix.py` still exercises it as row 12 via direct DB patch.

### UI scope decisions

- **Notes body limit**: 5,000 chars server-enforced via `zod` in
  `/api/prospects/[id]/notes/route.ts` and `[noteId]/route.ts`. Client textarea shows a
  live counter that switches to a warning tone at 4,900 chars.
- **Activity tab "include deleted note history" chip (T15)**: admin-only toggle that shows
  `category='note_deleted'` and `category='note_restored'` event_log rows in the feed.
  Deleted note bodies remain accessible via `NotesPanel`'s admin ghost (separate mechanism,
  role-branched).

### Kanban test shape (T18)

- **Single Playwright loop test** iterating the 42 `{fromState, toState}` non-self pairs,
  with per-pair assertion labels. Matches §5.5 literal wording; avoids the 42× browser
  bootstrap cost of splitting into individual test cases. A failure pinpoints the pair via
  the assertion message.

### Fixtures

- **`stage7_plant.py`**:
  - Invites `stage7-rep-a@example.com` and `stage7-rep-b@example.com` via
    `supabase.auth.admin.create_user` (idempotent).
  - Picks multiple non-canonical pipeline rows as lock-matrix subjects — one per lockable
    field, chosen by a "first row with this field populated AND not a canonical seed (MFA,
    Boston Ballet)" heuristic. Snapshots each subject's full 15-field vector to
    `cache/stage7_snapshot.json`.
  - Seeds two `prospect_notes` rows authored by Rep A on a designated note-subject prospect
    (for the soft-delete / edit / admin-ghost flow tests T07–T11).
  - Writes `cache/stage7_snapshot.json` with `started_at_iso` for the T23 "errors since
    stage start" window assertion.

- **`stage7_cleanup.py`**:
  - Restores each lock-matrix subject's 15 scraped fields from `cache/stage7_snapshot.json`;
    clears `user_overrides` on those rows.
  - Hard-deletes seeded notes by marker tag.
  - Hard-deletes the manual-add prospect (`company_name = 'Stage 7 Manual Test'`).
  - **Retains synthetic reps** (supersedes plan §5.7 — Stage 8 needs them already seeded per
    §6.2 "Test reps A + B still present"). Stage 8's cleanup script removes them.

### Manual-add test (T20)

- **`company_name = "Stage 7 Manual Test"`**, no phone, no zip, no website — exercises the
  `business_key = 'manual-<uuid>'` branch cleanly. Reverted by `stage7_cleanup.py` via
  hard-delete on business_key prefix + company_name match.

### Integrity targets

- Same policy as Stage 6: both localhost AND Vercel preview must pass before exit.
- DB-facet checks (`.venv/bin/python scripts/stage7_integrity.py`).
- Lock matrix (`.venv/bin/python scripts/stage7_lock_matrix.py`) — 15/15.
- Playwright suite (`cd whrb-web && pnpm e2e --grep stage7`) against both environments.
- Regression: Stage 5 + Stage 6 Playwright specs must remain green on `main` preview (no DB
  fixtures required for the regression check — read-only grid + nav tests don't depend on
  planted notes/feedback).

### DB pre-state trusted

From Stage 6 exit record: 2 profiles (admin + `stage6a-smoke@example.com`? — verify at plant
time; memory note says Stage 6 cleanup deleted `stage6a-smoke@example.com` alongside
`stage6-rep@example.com`, so expect 1 profile), ~3,103 `public.prospects` rows, 0
`prospect_notes`, 0 `feedback`, `event_log` clean of `level='error'` rows since Stage 5.5.
Any divergence surfaces during the `stage7_plant.py` live sanity check.

### Screenshot set

- Two themes × seven scenes, captured manually via chrome-devtools MCP into
  `whrb-prospects/docs/screenshots/stage7/`: Detail with edit-in-progress, Detail with lock
  icon visible, Notes panel (Rep A + admin views), Activity tab (chronological), Kanban
  (drag-in-flight), Manual-add modal open, My Clients kanban (populated).

### Round-4 clarifications (immediate pre-implementation, 2026-04-20)

Captured per the companion plan's §17 round-4 addendum. These tighten earlier Pre-Stage-7
prep decisions and govern the in-session implementation.

- **Checkout location:** top-level `Listing/`, not a worktree. Any in-progress
  `.claude/worktrees/*` session exits first and re-enters the top-level path before cutting
  `stage7/editing-and-assignment` off `origin/main@7a6035f`.
- **Env populated (confirmed):** `whrb-prospects/.env` and `whrb-web/.env.local` are on
  disk, gitignored, and contain `WHRB dev` credentials. No additional env work needed
  before planting.
- **Pipeline rerun authorized:** `python pipeline.py` for T05 / lock matrix runs against
  live dev Supabase + live scrapers; logs to `cache/stage7_lock_run.log`; launched via
  Bash `run_in_background=true` (10-minute headroom).
- **Migration applied automatically:** `scripts/apply_migration.py` runs
  `whrb-web/supabase/migrations/001_prospect_update_guard.sql` against `WHRB dev` as part
  of the stage. No manual dashboard step.
- **Migration content (tightened):** only the `BEFORE UPDATE` column-auth trigger lands.
  `p_prospects_insert` in `000_init.sql:301–303` is already admin-only, so the
  "admin-only INSERT policy" half of §16.2 item 7 is already satisfied. Migration is
  self-documenting and idempotent (`create or replace function` + `drop trigger if exists`).
- **Trigger details:**
  - Name: `public.enforce_prospect_update_guard()`, `security definer`, `search_path = public`.
  - Admin + assignee may update any column; any other authenticated user may only change
    `assigned_to` and `assigned_at` (plus the implicit `updated_at` written by the
    pre-existing `t_prospects_touch` trigger).
  - Violation raises `insufficient_privilege` (SQLSTATE `42501`) so PostgREST returns
    HTTP 403.
  - `auth.uid() is null` → no-op (service-role pipeline path preserved).
  - Registered `before update on prospects` so it fires before the after-update
    `audit_prospect_change` trigger — prevents logging denied field changes.
- **DELETE route scope (reaffirmed):** no `DELETE /api/prospects/[id]` in Stage 7.
- **Post-restore note semantics:** admin "Restore" clears `deleted_at + deleted_by`; author
  regains edit / re-delete capability; admins retain delete / restore. Idempotent with
  pre-delete state.
- **Realtime tests:** T01 + T06 use Playwright dual-context (`browser.newContext()`)
  pattern — two independent storage states. Realtime must deliver within 2 s; no
  polling fallback.
- **Workflow cadence:** single-shot implementation with no mid-stage pauses (migration →
  deps → API → components → pages → Python scripts → Playwright specs → plant → integrity
  → pipeline rerun → cleanup → push → preview re-verify → PR open).
- **Branch push policy:** Claude pushes `stage7/editing-and-assignment` directly once
  local checks pass; Vercel + CI run Playwright against the preview; PR opens when preview
  is green; user handles merge.
- **`audit_prospect_change` verified pre-existing** in `000_init.sql:244` — three categories
  (`prospect_state_change`, `prospect_assignment_change`, `prospect_field_change`) match
  plan expectations. `ActivityTab.tsx` consumes as-is; no trigger changes.

---

