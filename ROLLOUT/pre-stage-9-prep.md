# Pre-Stage-9 prep (2026-04-21)

Captures the round-8 clarifications before Stage 9 implementation begins.
These answers lock in scope, entry-state assumptions, and the plan
deviations Stage 9 is authorized to carry vs. plan §7.

### Round-8 clarifications (2026-04-21)

1. **Location policy.** Stage 9 branch `stage9/admin-console` is cut off
   `origin/main` (at `3ee3acb`, the Stage 8 merge) in the top-level
   `Listing/` checkout. Any pre-existing worktree exits first. Matches
   Stage 6 (§15.1), Stage 7 (§17.1), and Stage 8 (§6.3) precedent.
2. **PR cadence.** Single consolidated commit when all integrity checks
   are green; push + open PR `stage9/admin-console` → `main`; user
   handles merge.
3. **Preflight.** Accept the Stage 8 exit record as the trusted baseline
   (same tolerance granted to Stages 3 → 4, 6 → 7). Before plant, spot-
   check `event_log` for new `level in ('error','fatal')` rows since
   Stage 8 exit and halt if non-zero.
4. **"Deactivate" semantics — plan deviation.** Plan §7.4 names a
   "deactivate control" but schema has no `deactivated_at`. User
   approved the combined approach:
   - New migration `002_profiles_deactivation.sql` adds
     `deactivated_at timestamptz` (nullable) to `profiles`.
   - `/admin/users` ships **two distinct controls**:
     - **Deactivate / Reactivate** (reversible) — PATCH sets or clears
       `deactivated_at`.
     - **Remove** (irreversible) — calls
       `supabase.auth.admin.deleteUser(id)`; cascades via
       `profiles.id → auth.users(id) on delete cascade`.
   - **Enforcement**: `middleware.ts` redirects any signed-in user whose
     `profiles.deactivated_at is not null` to `/login?deactivated=1` and
     clears their session. Without enforcement, "deactivate" is
     cosmetic.
   - **Test coverage**: Stage 9 Tk count widens from 14 → 16 — new
     **T06b** (deactivate / reactivate round-trip) and **T06c**
     (hard-delete via Remove button) documented in the Tk table below.
5. **T04 pipeline rerun scope.** Uses `python pipeline.py --dry` (not a
   full `--with-hic` run). Rationale: `--dry` still executes
   `seed_source_config()` + `read_enabled_sources()` at startup, so the
   `boston_food` gate is exercised end-to-end, but caps each scraper at
   ~5 rows and skips enrichment (~1–2 min instead of ~9 min). Satisfies
   T04's assertions (i) no new `source='boston_food'` rows inserted
   during the run window and (ii) existing `boston_food` rows'
   `pipeline_last_seen_at` unchanged. Documented as plan deviation from
   §7.5's implicit full-run shape.
6. **T05 invite target mailbox.** Real invite via `inviteUserByEmail`
   against Supabase's default dev SMTP. Recipient:
   `Crimsoncowy@gmail.com` (user-supplied). Assertion: the
   `/api/admin/users/invite` response is 200, the new `auth.users` row
   appears (pre-`profiles` per `on_auth_user_created` trigger contract),
   and an email is received within 60s. Cleanup hard-deletes the invited
   user via `auth.admin.delete_user` after the check.
7. **T11 feedback refresh model.** Page-refresh, not Realtime. Admin
   PATCHes `/api/admin/feedback/[id]` with status + `admin_response`;
   user reloads Home; `FeedbackHistory` reflects the update. Rationale:
   feedback-status updates are rare, not time-critical, and Stage 9 is
   scoped to admin console surfaces. Realtime on `feedback` remains a
   Stage 10b polish candidate.
8. **"Trigger new run" button.** Rendered on `/admin/runs` but visually
   disabled with a "wired in Stage 10" affordance; clicks are no-ops.
   Stage 10 wires `POST /api/pipeline/run`.
9. **Playwright coverage.** One `whrb-web/e2e/stage9/*.spec.ts` per Tk
   with a UI facet. Stage 9 setup
   (`whrb-web/e2e/stage9/stage9.setup.ts`) regenerates admin +
   synthetic-rep storage states via the same magic-link bypass
   (`generateLink('magiclink') + verifyOtp`) used in Stage 7 / 8.
10. **Regression T14.** Each prior stage's DB-side integrity script
    (`stage5_integrity.py`, `stage6_integrity.py`, `stage7_integrity.py`,
    `stage8_integrity.py`) plus `pnpm e2e --grep "stage6|stage7"`. Full
    unfiltered Playwright suite is not required for Stage 9 exit.

### Stage 9 entry-state verification (expected, 2026-04-21)

To be verified by `stage9_plant.py` preflight immediately before plant:

- `prospects` ≥ 3,103 (post-Stage-8 cleanup state).
- `prospect_notes` = 0 (Stage 8 cleanup scrub).
- `profiles` = 3 (two admins + `stage6a-smoke@example.com`) — synthetic
  Stage-7 reps already torn down by Stage 8.
- `prospects.user_overrides` non-empty = 0.
- `source_config` = 9 rows, all `enabled = true`.
- `event_log` `level in ('error','fatal')` since Stage 8 exit: **0**.

If any precondition diverges, plant halts and surfaces the delta.

### Revised Tk matrix (14 base + 2 deactivation additions)

| ID  | Category | Check |
|-----|----------|-------|
| T01 | Sources  | Admin toggles `boston_food` off; row persists; refresh holds; `source_config.enabled=false` |
| T02 | Sources  | Non-admin GET on each of the 5 admin pages → 403 |
| T03 | Sources  | Non-admin PATCH on each admin API route → 403 (no write) |
| T04 | Sources  | `python pipeline.py --dry` with `boston_food` disabled: no new `boston_food` rows inserted; existing `boston_food` rows' `pipeline_last_seen_at` unchanged |
| T05 | Users    | Admin invites `Crimsoncowy@gmail.com`: email arrives within 60s; new `auth.users` row exists |
| T06  | Users    | Admin flips existing rep role to admin; next page-load picks up admin capability |
| T06b | Users    | Admin deactivates a rep (`deactivated_at` set); rep's next request redirects to `/login?deactivated=1`; admin reactivates; rep can sign in again |
| T06c | Users    | Admin clicks "Remove" on a synthetic rep; `auth.users` + `profiles` rows gone (cascade); API returns 200 |
| T07 | Logs     | Filter `level=error` matches `select … where level='error' order by created_at desc` |
| T08 | Logs     | Filters compose (level + category + date + text); result set matches direct SQL |
| T09 | Logs     | Row with `pipeline_run_id` clicks through to `/admin/runs/<id>` and the drill-down renders the run's `event_log` slice |
| T10 | Logs     | Non-admin 403 on `/admin/logs` page; anon Supabase `event_log` select still succeeds by RLS (documented transparency) |
| T11 | Feedback | Admin PATCHes `feedback.status` + `admin_response`; user reloads `/` → `FeedbackHistory` shows new values |
| T12 | Feedback | Admin writes `admin_response`; visible on user's feedback history |
| T13 | Logs     | 0 new `level='error' | 'fatal'` events since stage start (excludes T02/T03 deliberate 403 stimuli at `level='warn'`) |
| T14 | Regression | `stage5_integrity.py` + `stage6_integrity.py` + `stage7_integrity.py` + `stage8_integrity.py` all green; `pnpm e2e --grep "stage6|stage7"` passes against the preview |

### Fixtures

- `stage9_plant.py`:
  - Snapshots all 9 `source_config` rows (key / enabled / updated_at / updated_by) to `cache/stage9_snapshot.json`.
  - Records `pre_profile_count`, `pre_feedback_count`, and the
    `started_at_iso` reference timestamp.
  - Creates one synthetic rep (`stage9-rep@example.com`, confirmed via
    `create_user(email_confirm: True, password)`) for T02/T03 non-admin
    checks, T06 role flip, T06b deactivate round-trip, and T06c Remove.
    Password stored in the snapshot under `fixture_password`.
  - Toggles `boston_food.enabled = false` for T04.
  - Seeds one `feedback` row authored by the synthetic rep for T11/T12.
- `stage9_cleanup.py`:
  - Restores all 9 `source_config` rows to `enabled = true`, original
    `updated_by`.
  - Hard-deletes the invited T05 recipient (if it still exists).
  - Hard-deletes the synthetic rep (`stage9-rep@example.com`) via
    `auth.admin.delete_user` — covers both the "role-reset" and
    "remove" T06c paths idempotently.
  - Clears `deactivated_at` from any profile touched by T06b before
    delete (so a cleanup re-run on a half-torn-down state still
    terminates).
  - Hard-deletes the seeded feedback row.
  - Removes `cache/stage9_snapshot.json`.

### Stage 9 kickoff

Explicit "start Stage 9" authorization received 2026-04-21. Branch
created: `stage9/admin-console` at `3ee3acb`.


---

