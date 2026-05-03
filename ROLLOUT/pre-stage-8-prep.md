# Pre-Stage-8 prep (2026-04-20, post-Stage-7)

Post-merge readiness review of PR #8 (merge commit `b0739b7`). Documents the
Stage 7 coverage gaps accepted as known (not fixed pre-Stage-8), verifies
Stage 8's §6.2 entry conditions against live dev Supabase, locks in the
Stage 8 plant-transport decision, and records the process rule that no stage
starts without an explicit user command.

### Stage 7 Tk coverage — gaps accepted as known

A per-Tk audit (T01–T24 vs `stage7_integrity.py` + `whrb-web/e2e/stage7/*.spec.ts`
+ `stage7_lock_matrix.py`) found 19/24 **FULL**, 4 **PARTIAL**, 1 **MISSING**.
The user elected to **accept the gaps and proceed to Stage 8** rather than
land a `stage7-followup/*` PR. T05 (the load-bearing lock-matrix check that
Stage 8's contract depends on) is FULL, so the gaps below do not threaten
Stage 8's re-run idempotency assertion; they are UX-facing.

| Tk | Status | Gap |
|----|--------|-----|
| T06 | PARTIAL | `body: z.string().max(5000)` enforced at `whrb-web/app/api/prospects/[id]/notes/route.ts:10` and `[noteId]/route.ts:11`; no Playwright test sends a 5001-char body to assert the 400 |
| T11 | PARTIAL | `stage7_integrity.py:393–418` verifies rep-side RLS denial of `deleted_at IS NOT NULL` rows; no explicit assertion that an admin query returns the deleted rows |
| T12 | PARTIAL | `whrb-web/lib/time.ts` defines `TIMEZONE='America/New_York'` and components use `formatInTimeZone`; no Playwright test asserts the Activity-tab DOM renders in ET |
| T13 | MISSING | `prospect_assignment_change` event emission is verified by T02; the Activity-tab UI rendering of "Rep A reassigned … from Rep B to Rep C" is not exercised |
| T14 | PARTIAL | Audit triggers create add/edit/delete entries; no test asserts all three appear in chronological order in the Activity tab |

Stage 8 will not re-test these gaps; they are logged here so they can be
rolled into a later polish pass (Stage 10b candidate).

### Stage 8 §6.2 entry-state verification (live dev Supabase, 2026-04-20)

Read-only counts issued via service role against `kolfijjavwruwzctmnlx`:

- `prospects`: **3,103** rows — exceeds §6.2 floor of 2,935 ✅
- `prospect_notes`: **0** — Stage 7 cleanup scrubbed every planted + integrity-leftover row ✅
- `profiles`: **5** — both synthetic reps present with `role='rep'`, IDs
  `25507198-66ce-4d4a-a424-0f3c0802e861` (rep-a) and
  `07d70ee3-6691-4876-a10e-ce1f8187287a` (rep-b) ✅
- `prospects` with non-empty `user_overrides`: **0** — lock subjects fully restored ✅
- `prospects` matching `company_name ILIKE 'Stage 7 Manual Test%'`: **0** — no manual-add residue ✅
- `event_log` `level='error'` since Stage 7 start (2026-04-20): **0** — T23
  contract holds. (The 6 pre-existing error rows in the last 48h all date
  to 2026-04-19 and are Stage 5 intentional stimuli:
  `auth_callback_error` × 1, `unhandled_rejection × 3`, `api_exception × 1`
  from `/api/dev/throw`, `ui_exception × 1` from `stage5-ui-test`.) ✅

Entry state is clean; no pre-Stage-8 DB cleanup required.

### Stage 8 plant transport — locked

Per plan §6.5 ("browser session driven by chrome-devtools MCP or headless
httpx against /api/*"), user confirmed **chrome-devtools MCP (real browser)**.
Rationale: higher fidelity — also exercises client-side form logic, zod
validation, and the Realtime stack the way a real rep does. Trade-off:
harder to run in CI. Treated as a local exit gate for Stage 8; not wired
into the CI e2e workflow.

### Process rule (durable)

**No stage (8, 9, 10, 10b, 11, or any other) begins without an explicit user
command.** Review-only sessions end at the report boundary. This applies to
scaffolding, branch creation, plant scripts, and any Supabase mutation. A
request to "review" or "audit" is never implicit authorization to start the
next stage's work.

### Artifacts produced this prep

- This ROLLOUT subsection.
- Round-5 clarifications appended to
  `/Users/countcowy/.claude/plans/read-users-countcowy-claude-plans-soft-c-velvety-sonnet.md` §18.

### Stage 8 kickoff

Awaits explicit user command.


---

