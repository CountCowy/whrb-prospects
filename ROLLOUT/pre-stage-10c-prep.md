# Pre-Stage-10c prep (2026-04-22, post-Stage-10b merge)

### Close-outs from Stage 10b follow-ups

- **UPSTASH_REDIS_REST_TOKEN rotation: CLOSED.** Confirmed by user on
  2026-04-22 ahead of Stage 10c kickoff. The exposed token was rotated
  in the Upstash console and the new value propagated to
  `whrb-web/.env.local` + Vercel (Production / Preview / Development).
  Rate-limited endpoints (`/api/prospects/export`,
  `/api/admin/logs/export`) continue to evaluate against Upstash; Stage
  10b e2e T14–T15 remain authoritative. No Stage 10c scope depends on
  this rotation.
- **Stage 11 readiness memo: deferred** per plan §24.2 to post-Stage-10c
  exit, before Stage 11 kickoff prereq gathering. Rationale: Stage 10c
  is decoupled from Stage 11 per plan §23.1 — no dev/prod boundary is
  crossed, no new external prereqs surface, no Stage 10c scope depends
  on Stage 11 decisions.

### `GH_DISPATCH_PAT` on Next.js runtime

User confirmed `GH_DISPATCH_PAT` is present in both
`whrb-web/.env.local` and Vercel env vars (Preview + Development) so
the Stage 10c cancel API can authenticate its
`POST /repos/.../actions/runs/{id}/cancel` call. The workflow (Stage 10)
already had the PAT; Stage 10c reuses the same secret (plan §23.4).

### `event_log` preflight (plan §23.3 item 4 / §24.4)

Ran the whitelist check against dev Supabase
(`kolfijjavwruwzctmnlx`) ahead of branch cut:

```text
level in (error,fatal) since 2026-04-22T00:00:00Z: total=4  unexpected=0
  sample: 2026-04-22T14:09:30Z error source_failed  osm 406 Not Acceptable
  sample: 2026-04-22T14:09:30Z error scrape_http   retry exhausted 503
  sample: 2026-04-22T00:13:50Z error source_failed  osm 406 Not Acceptable
  sample: 2026-04-22T00:13:50Z error scrape_http   retry exhausted 503
prospects total=3218  stage10b_fixtures=0  pipeline_runs=21
```

All four error rows are whitelisted (`source_failed`, `scrape_http`
from the OSM Overpass API's ongoing 503/406 flakiness — same signal
Stage 10 T11 already tolerates). No unexpected categories. Stage 10c
kickoff unblocked.

### Entry-state verification (plan §23.4)

- **Prospects baseline:** 3,218 (up 26 from the 10b-teardown baseline
  of 3,192; delta is from the first post-10b-merge scheduled pipeline
  run at 13:42 UTC — expected).
- **`stage10b_fixture` rows:** 0 (confirmed clean — 10b cleanup ran).
- **`pipeline_runs` rows:** 21 retained, including the four Stage-10
  audit rows (`445a67ba` smoke, `3eae34de` T01-UI, `a263ef9e` scheduled,
  `2fbe6271` force-fail) plus 17 post-merge scheduled/manual runs.
  Stage 10c does not delete any of these.
- **Migration floor:** `004_prospects_notes_internal.sql`; slot `005`
  open.
- **Stale `stage10_snapshot.json` moved aside.** Pre-existing local
  cache artifact from the merged Stage-10 work was tripping up
  Playwright's `stage10.setup.ts` (expired magic-link token). Renamed
  to `stage10_snapshot.json.pre-stage10c-bak` for the duration of the
  integrity runs — outside git (`cache/` is gitignored). Does not
  affect DB state.

### Branch + workflow

- **Branch:** `stage10c/run-controls-and-bulk-selection` off
  `origin/main` (f2c6157, Stage 10b merge head), cut in the top-level
  `Listing/` checkout per plan §23.3 item 3.
- **Commit cadence:** single consolidated commit after every Tk green.
- **Exit artifact:** PR `stage10c/run-controls-and-bulk-selection →
  main`; user handles merge.

### Cross-session side tasks (non-Stage-10c)

Before branch cut, on explicit user go-ahead:

- **`consolidate-memory` skill run:** updated
  `feedback_no_auto_stage_advance.md` enumeration to include Stage 10c
  (was "Stages 1–11 + 6a + 10b"). No other changes.
- **`less-permission-prompts` skill run:** created project
  `.claude/settings.json` with 5 read-only patterns
  (`mcp__context7__query-docs`, `mcp__context7__resolve-library-id`,
  `mcp__github__search_code`, `mcp__chrome-devtools__take_snapshot`,
  `Bash(vercel ls *)`). De-duplicated against existing
  `.claude/settings.local.json`. No writes/mutations added.

---

