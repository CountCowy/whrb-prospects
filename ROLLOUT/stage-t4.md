# Stage T4 — Instrumentation, dashboard delta tiles, /media-kit, /guide, /changelog (2026-04-26)

- **Started:** 2026-04-26 ~12:00 America/New_York
- **Plan:** `users-countcowy-downloads-media-kit-202-gleaming-dawn.md` §6 (T4)
- **Branch:** `t4/instrumentation-and-guide` off `main` (`7784082`)
- **Project:** `kolfijjavwruwzctmnlx` (WHRB dev)
- **Migration:** `011_instrumentation.sql` (+ `011_rollback.sql`)
- **Commits:** `da0ba66` (impl) + `7c4b25c` (review-round-1 fixes)
- **PR:** opened against `main`

### Artifacts produced

**Migration `011_instrumentation.sql`.**
- `filter_impressions` raw table with a generated UTC `impression_date`
  column + per-day unique index `(user_id, prospect_id, impression_date)`
  for idempotent batched inserts.
- `filter_impression_stats` (week-grain rollup, indefinite retention).
- `event_log_stats` (week-grain rollup of pruned event_log rows).
- `changelog_entries` table with audience enum
  (`'all' | 'rep' | 'admin'`) + RLS scoped to viewer role.
- `profiles.last_changelog_ack timestamptz` for the per-user
  first-login toast cursor.
- `source_config` extended: new `status` enum
  (`active | sunset_proposed | sunset | archived`), new
  `status_changed_at`, two-way sync trigger so legacy
  `enabled` toggles stay in lockstep with the new `status`.
- One-off backfill: synthesizes `dedupe_match` events from existing
  comma-joined `prospects.source` values (one event per non-winner
  contributor, guarded against re-run).
- Mirror appended to `whrb-prospects/db/schema.sql`. Paired
  `011_rollback.sql` drops everything.

**Web (Next.js + shadcn/Radix).**
- `whrb-web/config/rate-card.ts` — single source of truth for the
  media-kit data: `RATE_CARD` (regular + special spots + print + web),
  `MEDIA_KIT_STATS`, `MEDIA_KIT_PDF_FILENAME`, `FEATURED_CLIENTS` (9),
  `SIGNAL_CITIES` (15 across local/distant/fringe), `PROGRAM_CARDS` (9).
- `whrb-web/public/media-kit/clients/*.png` — 9 client logos
  extracted from p7 of `media-kit-2026.pdf` at 2x.
- `whrb-web/components/MediaKitHero.tsx` (hero + stats strip + PDF
  download CTA via `<Button asChild>`).
- `whrb-web/components/RateCard.tsx` (accessible `<table>` w/
  sticky-program column on mobile; cross-link CTAs to
  `/prospects?daypart=…`).
- `whrb-web/components/SignalMap.tsx` (decorative inline SVG with
  three rings + city dots; `<details>` fallback list of every city as
  real anchors → `?affiliation=…`; SVG is `aria-hidden` to satisfy
  axe-core).
- `whrb-web/components/FeaturedClients.tsx` (server component;
  case-insensitive `prospects.company_name` match → `/prospects/[id]`
  for matched clients, `fallbackUrl` otherwise).
- `whrb-web/components/admin/SourceStatusBadge.tsx` (extracted in
  review-round-1; maps `active → success`, `sunset_proposed →
  warning`, `sunset → secondary`, `archived → destructive`).
- `whrb-web/components/admin/SourceLifecycleButton.tsx` (Propose
  sunset / Revert to active client component).
- `whrb-web/components/admin/ChangelogAdminEditor.tsx` (publish
  entry; client-side title + word-count guards).
- `whrb-web/components/ChangelogToast.tsx` (Sonner toast that fires
  on first login when an unread entry exists; rAF-deferred toast call
  to avoid the Toaster mount race in dev; ack POSTs to
  `/api/changelog/ack`).
- `whrb-web/lib/queries/sources.ts` (`listSourceMetrics`,
  `listReviewCandidates`, `listSourceSampleRows`).
- `whrb-web/lib/queries/changelog.ts` (`listChangelogEntries`,
  `getPendingChangelogForUser`).
- `whrb-web/lib/hooks/use-impressions.ts` (sessionStorage-deduped
  fire-and-forget POST).
- `whrb-web/app/(app)/media-kit/page.tsx` — 7-section content fill.
- `whrb-web/app/(app)/guide/page.tsx` — 10-section content fill,
  ~499 prose words (target 400–650).
- `whrb-web/app/(app)/changelog/page.tsx` (rep + admin RLS-filtered).
- `whrb-web/app/(app)/admin/changelog/page.tsx` (admin-only editor
  + entry list; pinned entries float for 14 days).
- `whrb-web/app/(app)/admin/sources/page.tsx` extended with the new
  metrics columns + Status badge + countdown + Propose/Revert + Tabs
  (`All sources / Review candidates`).
- `whrb-web/app/(app)/admin/sources/[key]/page.tsx` — drill-down
  with metric cards + sample-rows table.
- `whrb-web/app/(app)/page.tsx` — 3 new delta tiles appended; the
  hrefless "Tag changes this week" tile uses Radix `<Tooltip>` with
  a focusable button trigger so the Monday-reset hint is reachable
  by keyboard + screen reader.
- `whrb-web/app/(app)/layout.tsx` — wires `<ChangelogToast
  pendingEntry={…}>` from `getPendingChangelogForUser()`.
- `whrb-web/app/api/prospects/impressions/route.ts` — batched POST
  with `onConflict` ignore on the daily-unique index.
- `whrb-web/app/api/changelog/ack/route.ts` — bumps
  `profiles.last_changelog_ack`.
- `whrb-web/app/api/admin/changelog/route.ts` — admin-only POST.
- `whrb-web/app/api/admin/sources/[key]/lifecycle/route.ts` —
  Propose-sunset / Revert-to-active with admin gate + lifecycle
  events.
- `whrb-web/components/ProspectTable.tsx` — `useImpressions(rows,
  searchSig)` wired in.
- `whrb-web/components/command-palette-routes.ts` — adds
  `/changelog` (Navigate) + `Admin · Changelog` (Admin).

**Pipeline + scripts.**
- `whrb-prospects/pipeline.py::score()` rewritten to **V2 launch
  weights** (plan §1.3 #12): tier base + `+1` per budget-signal axis +
  `+1` for `history` presence + `+1` for harvard/mit affiliation +
  `-20` per compliance value. V1 retained behind
  `config.SCORE_WEIGHTS_V2_LAUNCH` toggle.
- `whrb-prospects/enrich/dedupe.py::_merge` emits a `dedupe_match`
  event on every successful merge (winning_source, losing_source,
  business_key) — fire-and-forget.
- `whrb-prospects/scripts/apply_t4_migration.py` (pooler-first,
  `--rollback`, `--dry-run`).
- `whrb-prospects/scripts/rollup_impressions.py` (nightly: aggregate
  >30d filter_impressions into stats, delete raw).
- `whrb-prospects/scripts/prune_event_log.py` (nightly: per-bucket
  retention — errors/audit 6mo, instrumentation 3mo, pipeline_% 90d,
  default 90d — rolls deletions into event_log_stats; idempotent via a
  prune-cursor row in `pipeline_runs`).
- `whrb-prospects/scripts/advance_source_lifecycle.py` (nightly:
  `sunset_proposed → sunset` at 15d, `sunset → archived` at 30d more;
  emits `source_sunset_auto` / `source_archived_auto` events).
- `whrb-prospects/scripts/ci_require_changelog.sh` (PR gate:
  `rep-ui-change` label requires a changelog INSERT in the diff).
- `.github/workflows/nightly-maintenance.yml` (combined cron at
  `0 9 * * *` UTC, `continue-on-error: true` per step so flakes don't
  cascade).

**Fixtures + integrity.**
- `whrb-prospects/scripts/t4_plant.py` — 3 sold prospects (osm), 5
  dedupe events (yelp losing to osm), 10 filter_impressions across 5
  UTC days, 5 backdated event_log rows per retention bucket, 2
  source_config rows in transitional states with rigged
  `status_changed_at`, 1 `audience='rep'` changelog entry, 1 BSO
  fixture for the featured-client name-match.
- `whrb-prospects/scripts/t4_cleanup.py` — idempotent reverse.
- `whrb-prospects/scripts/t4_integrity.py` — 37 test runs (T01-T31
  across 14 categories with sub-tests); final result **19 PASS / 17
  SKIP-BROWSER / 1 SKIP-MANUAL / 0 FAIL**.
- `whrb-web/e2e/t4/{t4.setup,helpers,media-kit,guide,admin-sources,
  changelog,impressions,rls}.spec.ts` — 21 Playwright tests covering
  every browser-tagged Tk; final result **21/21 PASS + 2 setups
  PASS + 7 unrelated-stage setups SKIP**.

### Run ledger

- 12:24 — `apply_t4_migration.py` applied `011_instrumentation.sql`
  (9,770 bytes). Verification: 4 new tables created, `source_config`
  status distribution 8 active / 1 sunset_proposed (the bbb row that
  was already disabled), 90 dedupe_match backfill events synthesized
  from existing prospects.source comma-lists.
- 12:27 — Extracted 9 PNG logos via `pdfimages -f 7 -l 7 -png` from
  `whrb-web/public/media-kit-2026.pdf` to
  `whrb-web/public/media-kit/clients/`.
- 12:46–13:00 — Iterated through web-side build of the 7-section
  /media-kit, /guide, /changelog, /admin/changelog, /admin/sources
  extensions, home dashboard tiles. `pnpm typecheck/lint/test:run/build`
  clean throughout.
- 13:08 — `t4_plant.py` first plant. `t4_integrity.py` first run:
  18 PASS / 17 SKIP-BROWSER / 1 SKIP-MANUAL / 1 FAIL (T18 prune
  script rc=1 from a psycopg2 `%`-escape bug in `category like
  'pipeline_%'`).
- 13:11 — Fixed prune to `'pipeline\_%%' escape '\'`. Re-plant +
  re-integrity: **19 PASS / 17 SKIP-BROWSER / 1 SKIP-MANUAL / 0 FAIL**.
- 13:30–14:00 — Iterated Playwright e2e:
  - First run: 16 passed, 7 failed (testid `filter({ has })` patterns
    against same-element attrs; T21 toast race; T28 multi-row name
    match; T30 axe failures from interactive SVG city dots and a
    "Use of Color" link without underline).
  - Round 1 fix: switch all "filter on attribute on the same element"
    selectors to compound-attr selectors; fix T21 by service-role
    resetting both `last_changelog_ack` and the entry's
    `released_at`; fix T28 to accept any matched UUID; convert
    SignalMap city dots to decorative + `aria-hidden`; add explicit
    `underline` to inline links in media-kit prose; defer the toast
    via `requestAnimationFrame` to dodge the Toaster mount race.
  - Final result: **21/21 + 2 setups PASS** (1m 36s).
- 14:00 — Committed `da0ba66`: full T4 implementation.
- 14:01–14:14 — `/verify-ui` ran the screenshot pipeline → 44
  captures (16 routes × {light, dark} + 12 probe captures) all
  intact. 44 observations filled in `.ui-verified.json`. 0 defects
  identified.
- 14:14 — `/review-ui` audit subagent surfaced 1 medium + 3 low:
  - M1: `tile-delta-tag-changes` no-href tile relied on native
    `title=` on a non-focusable `<div>`.
  - L1: `MediaKitHero` download anchor reimplemented Button cva.
  - L2/L3: `StatusBadge` mapped Active → `default` (brand crimson)
    instead of the `success` semantic variant.
- 14:14 — Round-1 fixes (commit `7c4b25c`):
  - `app/(app)/page.tsx` — wrap hrefless tile in Radix `<Tooltip>`
    with focusable `<button type="button">` trigger.
  - `MediaKitHero.tsx` — `<Button asChild>` around the download `<a>`.
  - `components/admin/SourceStatusBadge.tsx` — extracted; both
    `/admin/sources` and `/admin/sources/[key]` import it.
- 14:14 — Re-ran gate: typecheck/lint/test:run/build clean; e2e
  21/21 + 2 setups; .review-clean.json written with 0 unresolved
  blocking findings.

### Integrity test results — `scripts/t4_integrity.py`

```
Stage T4 integrity
  snapshot: whrb-prospects/cache/t4_snapshot.json

[PASS]         T01  osm closed/contributed >= 3 (3/2171)
[PASS]         T02  yelp losing events >= 5 (5)
[SKIP-BROWSER] T03  ProspectTable POSTs impressions on render
[PASS]         T04  daily-unique index dropped same-day duplicate
[PASS]         T05  impression anchor present in non-default impressions
[PASS]         T06  pipeline_runs query OK
[PASS]         T07  tag_changes_this_week query OK
[PASS]         T08  gone_quiet query OK
[SKIP-BROWSER] T09  /guide rendering
[PASS]         T09.wc  guide prose word count ~ 499 (within bound)
[SKIP-BROWSER] T10  /guide link resolution
[PASS]         T11  score() v2 outputs [31, 33, -15, 15, -25]
[PASS]         T12.svc  service-role sees 10 impressions
[SKIP-BROWSER] T12.anon  Anon RLS denial
[SKIP-BROWSER] T13  /admin/sources admin-gating
[PASS]         T14  no error/fatal events since stage start
[PASS]         T15  rollup ran; stats has 1 fixture row(s)
[PASS]         T16.attribution  BSO fixture credits source
[SKIP-BROWSER] T16.tooltip  Tooltip render
[SKIP-MANUAL]  T17  Prior-stage integrity (verified pre-merge)
[PASS]         T18  prune deleted 5 backdated rows; event_log_stats=5
[PASS]         T19  lifecycle promoted both fixtures
[PASS]         T19.events  2 lifecycle events emitted
[SKIP-BROWSER] T20  /admin/sources Status column + countdown
[SKIP-BROWSER] T21  changelog toast
[PASS]         T22.svc  service-role sees changelog entries
[SKIP-BROWSER] T22.anon  Anon RLS denial
[PASS]         T23  guide About has credit + /changelog + /media-kit
[SKIP-BROWSER] T24  /media-kit renders 7 sections + stats strip
[SKIP-BROWSER] T25  Rate-card values match config
[SKIP-BROWSER] T26  Rate-card program links resolve
[SKIP-BROWSER] T27  Signal map SVG + fallback list
[SKIP-BROWSER] T28  Featured-client BSO match
[SKIP-BROWSER] T29  Download print PDF link
[SKIP-BROWSER] T30  axe-core WCAG 2.1 AA on /media-kit
[SKIP-BROWSER] T31  Mobile viewport
[PASS]         T25.config  rate-card.ts contains the 4 regular + special

Stage T4 Tks: pass=19 skip-browser=17 skip-manual=1 fail=0 (total 37)
```

### Web-app + pipeline gates

- `pnpm typecheck` — clean.
- `pnpm lint` — clean.
- `pnpm test:run` — 23/23 Vitest passes.
- `pnpm build` — clean; every route compiles.
- `pytest tests/` — 138/138.
- `ruff check` — clean.
- Playwright e2e `whrb-web/e2e/t4/`: **21/21 + 2 setups PASS**.
- `/verify-ui` 44/44 PNGs intact + 44 observations populated; 0 defects.
- `/review-ui` round-1 → all 4 findings (1 M + 3 L) addressed in
  `7c4b25c`; `.review-clean.json` written with 0 unresolved blocking.

### Plan deviations

1. **Schema slot bumped from 010 to 011 (per plan note).** The
   media-kit-PDF-driven naming convention was already established;
   `010_prospect_contact_emails.sql` consumed slot 010 prior to T4
   branching. Plan §6.4 explicitly anticipates this.

2. **Daily-unique constraint via generated stored column.** Plan
   sketches `UNIQUE (user_id, prospect_id, date_trunc('day',
   created_at))`, but `date_trunc` on `timestamptz` is `STABLE`, not
   `IMMUTABLE` — Postgres rejects it as an index expression. Used a
   stored generated column `impression_date date generated always as
   ((created_at at time zone 'UTC')::date) stored` instead; the
   semantic guarantee is identical and the index expression is
   trivially deterministic.

3. **dedupe_match backfill in-migration, not as a one-off Python
   script.** Plan §6.4 says "synthesize dedupe events from the
   existing `alt_fields` jsonb in `prospects`"; in practice
   `prospects.source` already encodes the contributor list as a
   comma-joined string (per `enrich/dedupe.py::_merge` line 142),
   which is a cleaner derivation than parsing `alt_fields`. The
   migration emits one event per non-winner contributor, guarded
   against re-run. 90 events synthesized at apply time.

4. **N=5 conventional rate-card cross-link to `/guide#seasonal-programs`.**
   Plan §6.4 cross-link table maps Special spots (Met Opera /
   Hillbilly / SNATO) to `/guide#seasonal-programs`. The guide's
   FAQ section uses `id="seasonal-programs"` as the anchor target;
   special-spot rows in `RateCard.tsx` link to it via the `href`
   field on `RateCardSpecial`. A future T4 polish iteration could
   add a dedicated seasonal-programs section earlier in /guide if
   needed.

5. **Toast `requestAnimationFrame` defer (review-round-1 deviation).**
   Plan §5.4 sketches the toast as a `useEffect`-on-mount pattern;
   in dev under React 18 strict mode + Sonner's queue-then-Toaster-
   subscribe race, the first toast call was occasionally dropped
   silently. Wrapping the `toast(…)` call in
   `window.requestAnimationFrame(…)` defers it by one frame so the
   parent `<Toaster>` is guaranteed to have mounted and subscribed.
   Documented inline.

6. **SourceStatusBadge variants beyond plan defaults
   (review-round-1).** Plan §6.4 doesn't specify which Badge
   variants the four lifecycle states should map to; round-1
   `/review-ui` flagged Active → `default` (brand crimson) as
   visually reading like a CTA. Mapping refactored to
   `active → success`, `sunset_proposed → warning`,
   `sunset → secondary`, `archived → destructive` per warm-palette
   semantic intent.

7. **Source lifecycle review criteria use `bot_detected_skip`
   events even though emission is T8.** Plan §6.4 trigger criteria
   include `bot_detected_skip` events in 3 of last 4 runs; T4 ships
   the *check* for these events but no source is emitting them yet
   (the Playwright sources in T8 are the producers). Until T8, the
   first criterion (`searched_rate < 5%` AND `close_rate = 0` for
   3 months) is the only one that surfaces candidates. Documented
   in `lib/queries/sources.ts::listReviewCandidates` comment.

### Stage T4 exit gate — effective state

**GREEN on every gate.**
19 PASS / 17 SKIP-BROWSER / 1 SKIP-MANUAL / 0 FAIL on
`scripts/t4_integrity.py`; **21/21 + 2 setups PASS** on Playwright
`whrb-web/e2e/t4/*.spec.ts`; `/verify-ui` 44/44 PNGs + observations
clean; `/review-ui` round-1 0 unresolved blocking; pnpm
typecheck/lint/test:run/build/pytest/ruff all clean.

Migration 011 applied + verified live on `WHRB dev`. Branch pushed
to `origin/t4/instrumentation-and-guide`.

Stage T4 implementation ends here. Per
`feedback_no_auto_stage_advance.md`, T5 (competitor-station sponsor
source) does **not** start until an explicit "start T5" command.

### Stage T4 deferred follow-ups (not blocking T5 entry)

A post-merge `/code-review` pass on PR #27 surfaced 11 findings (3 medium
+ 8 low). M1–M3 and L1–L6 landed inline as a follow-up commit; L7, L8,
and O1 are recorded here as backlog because each requires touching
artifacts that are out-of-scope for a review fix.

| ID | File / surface | Issue | Why deferred | Suggested home |
|----|---------------|-------|--------------|----------------|
| L7 | `whrb-prospects/scripts/prune_event_log.py:131–141, 187–193` | Idempotence cursor is stashed as a synthetic `pipeline_runs` row with `args = 'prune_event_log:<YYYY-MM-DD>'`. Pollutes the audit table that powers `/admin/runs` and the run-complete notification fan-out; a dedicated `cron_state(key, last_run_at)` table would be cleaner. | Needs a new migration. T4 occupies slot `011`; T5's plan §7.4 reserves `012_peer_stations.sql`. Adding `012_cron_state.sql` mid-T4 would collide with T5; adding it as `013_*` mid-stage would jump the migration counter. | T5 PR (bundled with `012_peer_stations.sql` so both ride the same migration cadence), OR a standalone "ops cleanup" PR after T5 exits. |
| L8 | `whrb-web/lib/queries/prospects.ts::getHomeStats` (lines 287–366) | 12 separate `count: 'exact', head: true` round-trips per home-page render. Fine at ~3k prospects (each is a HEAD, fully parallelized via `Promise.all`); will degrade past ~50k prospects or once we add user-personalised tiles. | Needs either a new SQL function (`select * from public.get_home_stats(p_user uuid)`) plus a `grant execute` migration, OR a materialised view with refresh-on-pipeline-finish. Either approach is a migration + supabase_sync wiring change too large for a review fix. | Re-evaluate at the **T8 scoring-tuning** checkpoint (≥3 months from launch, when prospect volume + tile count have grown). Track size + p50 latency on `/admin/runs` to know when to pull the trigger. |
| O1 | PR #27 branch `t4/instrumentation-and-guide` | Three non-T4 commits live on the branch: `944d43d` (notes optimistic-state preservation across tab switches), `0b7ca0a` (ui-pre-push-gate recognises env-var-prefixed `git push`), and `37e3878` (Stage 6 e2e flake fix — LIMIT 25 cap + cold-compile race). Each is a defensible inline fix (the e2e fix specifically addresses cold-compile pressure caused by T4's added routes), but they conflate scope: a `git bisect` for "Stage T4 introduced X" will pull non-T4 changes. | Process issue, not a code defect. Rebasing now would invalidate the merged PR's CI and rewrite committed history. | Pre-merge for **future stages**: when a non-stage fix is needed mid-stage, branch off the stage branch into `fix/<short>` and PR it to `main` ahead of the stage merge. ROLLOUT entry for T5 onwards should cite this convention. |

T5 (`competitor-station-source`) does not depend on any of the above.
L7 is the most likely to bite first — every nightly `prune_event_log`
run inserts one synthetic row, so `/admin/runs` page will accumulate
~30 noise rows per month. L8 has zero practical impact at current
scale and is purely a future-proofing note.

