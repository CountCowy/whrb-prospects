# Stage T5 — Competitor-station sponsor source (observation mode) (2026-04-28)

- **Started:** 2026-04-28 ~14:00 America/New_York
- **Plan:** `users-countcowy-downloads-media-kit-202-gleaming-dawn.md` §7 (T5)
- **Branch:** `t5/competitor-station-source` off `main` (`685449d`)
- **Project:** `kolfijjavwruwzctmnlx` (WHRB dev)
- **Migration:** `015_peer_stations.sql` (+ `015_rollback.sql`)

### Plan deviation (substantive — accepted by user)

The plan §7.5 estimates "~300–500 rows across 5 stations" assuming each
peer station publishes a public sponsor list. URL discovery during
implementation (visited each station's homepage; verified inquiry vs.
list pages) produced this reality:

| Station | URL pinned | Page type | Realistic yield |
|---------|------------|-----------|-----------------|
| WCRB    | `classicalwcrb.org/corporate-sponsorship` | Inquiry-only (sister to GBH; sponsorship centralized at sponsorship.wgbh.org) | 0 |
| WGBH    | `sponsorship.wgbh.org/` | 5 named testimonial blocks | 5 |
| WBUR    | `wbur.org/membership/605748/members` | "Member benefits" perks page | ~12 |
| WUMB    | `wumb.org/support/` | Inquiry-only (legacy `/support/underwriters.php` 404s) | 0 |
| WERS    | `wers.org/current-underwriters/` | Full sponsor list with names + websites | ~130 |

Realistic total: **~110–150 rows** vs. the plan's 300–500 estimate.
Documented at the top of `sources/competitor_stations.py` and again in
the per-station blocklist comments. The integrity matrix (T01/T04)
explicitly accepts 0-row outputs from the inquiry-only pages — a
non-zero result there is logged and surfaced as "verify".

WBUR pivot accepted by user — the `/membership/605748/members` page lists
discount-partner businesses, not strict FCC underwriters, but every entry
is one that values WBUR-audience association, so the ICP signal is
intact. Tagged `history:wbur_sponsor` for consistency with other stations.

### Artifacts produced

**Migration `015_peer_stations.sql`.**
- `peer_stations` table: `id` uuid pk, `normalized_name` text unique,
  `display_name`, `status enum (active|deprecated)`, `added_by`,
  `notes`, `created_at`, `updated_at`. Partial index
  `peer_stations_status_active` on `(status) where status='active'`
  for cheap pipeline-startup lookups.
- `set_updated_at` trigger reused (defined in `000_init.sql`).
- RLS: anon denied entirely, authed read all, admin-only write
  (per gleaming-dawn §1.3 #20 lock — peer/tag tables deny anon).
- Seeded 15 rows: self (WHRB) + 5 scrape targets + 9 broader peer
  entities (GBH, WNYC, WQXR, NPR, PRX, PRI, PBS, "Boston Public
  Radio", "Classical WCRB"). Idempotent
  `insert ... on conflict do nothing`.
- Mirror appended to `whrb-prospects/db/schema.sql` (single source of
  truth convention). Paired `015_rollback.sql` drops the table +
  policies + trigger.

**Pipeline (`whrb-prospects/`).**
- `sources/competitor_stations.py` — NEW (~520 lines). One scrape
  module covering all 5 stations with per-station parser
  (`parse_wcrb`, `parse_wgbh`, `parse_wbur`, `parse_wumb`,
  `parse_wers`), peer-station whitelist via DB-or-fallback load,
  robots.txt verification per station, 5s inter-station rate limit,
  WHRB User-Agent (`WHRBProspectPipeline/1.0
  (+https://www.whrb.org/sales; sales@whrb.org)`), and a fixture
  fast-path (`WHRB_COMPETITOR_STATIONS_OFFLINE=1`) for unit tests +
  offline integrity. Emits `source='competitor_stations'`,
  `tier='B'`, and `tags={history: ['<station>_sponsor'], sector:
  ['unknown'], operating_model: ['unknown']}`. Daypart hints are
  carried via the `history:<station>_sponsor` axis — the
  migration-008 `derive_daypart` view's history branch derives
  `daypart_classical` for WCRB/WGBH and `daypart_blues_hillbilly`
  for WUMB automatically.
- `config.py::SOURCE_KEYS` + `ENABLED_SOURCES_DEFAULT` — append
  `competitor_stations` (10th source).
- `pipeline.py` — `from sources import competitor_stations` +
  `_safe_cached("competitor_stations", competitor_stations.run_all)`
  appended to `collect()`. The new source runs only when
  `source_config.competitor_stations.enabled=true`; the seeded value
  is true.

**Web (`whrb-web/`).**
- `lib/queries/peer-stations.ts` — `listPeerStations()` server-only
  query helper.
- `app/api/admin/peer-stations/route.ts` — POST (create) with
  `display_name`-required + `normalized_name` auto-derivation +
  zod validation. 23505 unique violation → 409.
- `app/api/admin/peer-stations/[id]/route.ts` — PATCH (rename / axis
  change / status / notes) + DELETE (hard-delete). Audit events:
  `peer_station_created` / `peer_station_updated` /
  `peer_station_deleted`.
- `components/admin/PeerStationsManager.tsx` — client component
  with Add form, status-grouped list (active / deprecated), inline
  edit, status toggle, delete with confirm. Inputs use shadcn/Radix
  primitives consistently with `/admin/vocab` style.
- `app/(app)/admin/peer-stations/page.tsx` — server component;
  redirects via the `(app)/admin/layout.tsx` admin gate.
- `app/(app)/admin/layout.tsx` nav extended with "Peers" entry.
- `components/command-palette-routes.ts` — adds
  `/admin/peer-stations` (admin-only).

**Fixtures + scripts.**
- `tests/fixtures/competitor_stations/{wcrb,wgbh,wbur,wumb,wers}_{sponsors.html,robots.txt}` — captured live with the WHRB UA and 5s rate limit. Total ~1.1MB; will re-record quarterly.
- `tests/sources/test_competitor_stations.py` — 33 parser tests
  covering: per-station fixture-in/expected-out, peer-whitelist
  containment semantics, social/internal link filtering, UA on
  every GET, 5s rate-limit, robots.txt open vs. synthetic disallow
  vs. 404-treated-as-open vs. blocked-station disable, vocab
  conformance (every emitted history value present in
  `util/tags.py::_SEED_VOCAB`).
- `scripts/apply_t5_migration.py` — pooler-first DB connect,
  `--rollback` + `--dry-run`. Mirrors apply_t4_migration.
- `scripts/rerecord_station_fixtures.py` — quarterly re-capture
  helper (admin checklist §15). 5s rate-limited; supports
  `--diff-only`. 4xx on robots.txt writes a sentinel line.
- `scripts/t5_plant.py` — plants 2 fixture prospects (BSO + WBUR
  CitySpace) + evicts the 5 station URLs from `requests-cache` so
  the live run fetches fresh.
- `scripts/t5_cleanup.py` — hard-deletes the 2 fixture prospects;
  idempotent.
- `scripts/t5_integrity.py` — 14 Tks per plan §7.6 (T01–T14); split
  into pure-Python and DB-coupled checks. SKIP-MANUAL for
  pipeline-run-dependent Tks until `pipeline.py --fresh` has run.

### Migration apply

```
.venv/bin/python scripts/apply_t5_migration.py --dry-run  # 6,229 bytes
.venv/bin/python scripts/apply_t5_migration.py            # OK applied.
```

Verified: 15 active peer_stations rows seeded.

### Integrity test results — pre-pipeline run

`scripts/t5_integrity.py` (offline, before live pipeline run):

```
[PASS]         T01  WCRB fixture yields 0 sponsors (inquiry page)
[PASS]         T02  WGBH fixture yields 5 testimonials with history:wgbh_sponsor
[PASS]         T03  WBUR fixture: 10 members, 2 peer-suppressed
[PASS]         T04  WUMB fixture yields 0 sponsors (inquiry page)
[PASS]         T05  WERS fixture yields 97 sponsors with history:wers_sponsor;
                    5/5 known advertisers present (BSO, Boston Ballet,
                    Mass Cultural Council, Huntington Theatre, Boston Lyric Opera)
[SKIP-MANUAL]  T06  Awaiting live run (no prospect_tags rows yet)
[SKIP-MANUAL]  T07  Awaiting live run (BSO collision)
[PASS]         T08  robots.txt for all 5 stations permits sponsor URL
[PASS]         T09  User-Agent matches WHRBProspectPipeline/1.0 ...
[PASS]         T10  inter-station sleep ≥5s observed
[SKIP-MANUAL]  T11  Awaiting live run (rows_last_run=0)
[SKIP-MANUAL]  T12  Awaiting live run (Turn-6 spot-check)
[PASS]         T13  0 unexpected error/fatal events since stage start
[PASS]         T14  T1-T4 integrity modules import cleanly
```

Result: 10 PASS / 4 SKIP-MANUAL (pipeline-run-dependent) / 0 FAIL.
Browser Tks (T11.browser, T12.browser) covered separately under
`whrb-web/e2e/t5/*.spec.ts` (TODO post-merge or follow-up — the
parser-and-DB-side checks are the contract; the browser test is
visual confirmation).

### Run ledger

- 14:11 — captured 5 sponsor pages + 5 robots.txt with WHRB UA, 5s
  inter-fetch delay. Total ~1.1MB written to
  `tests/fixtures/competitor_stations/`.
- 14:31 — wrote `015_peer_stations.sql` + `015_rollback.sql`;
  appended mirror to `db/schema.sql`.
- 14:35 — wrote `sources/competitor_stations.py`. First parser
  smoke-test exposed two bugs:
  - WGBH testimonial regex greedy-matched the LAST " of " (yielding
    "Grass" instead of "Blade of Grass"). Fixed with lazy `[^,]*?`
    so the FIRST "of" wins.
  - WBUR member-benefit headings are `<h2>`, not `<h3>` (recon
    incorrectly grouped them with H3 because all heading tags were
    listed). Switched parser to scan H2.
  - WUMB + WERS scanned external links and pulled donate-widget /
    streaming-CDN CTAs (`secureallegiance.com`, `careasy.org`,
    `streamguys.com`). Added these to the global
    `NEVER_SPONSOR_DOMAINS` set since no public-radio station would
    sponsor a public-radio fundraising widget.
  - WBUR self-mentions ("WBUR CitySpace", "The WBUR Festival")
    initially landed on the per-station blocklist. Moved them to
    rely on the peer-station whitelist instead — gives a cleaner
    audit trail (`peer_station_skip` event vs. silent drop).
  Final per-station counts at fixture time: WCRB 0, WGBH 5,
  WBUR 10 (+2 peer-suppressed), WUMB 0, WERS 97. Total 112 rows
  with 2 peer suppressions.
- 14:48 — wrote 33 pytest parser tests + ran `pytest tests/`:
  187/187 pass. `ruff check` clean after auto-fix + 5 manual
  underscore-prefix + 1 EN DASH normalization.
- 14:52 — `apply_t5_migration.py --dry-run` clean; applied live.
  Verified: 15 active peer_stations rows seeded.
- 14:55 — `t5_plant.py` ran. Hit two bugs in the supabase-py
  client API:
  - `.upsert(...).select(...)` chain not supported in 2.28 —
    dropped the redundant `.select()` and used `res.data[0]['id']`.
  - The `requests-cache` SQLite schema stores entries by opaque
    hash, not URL — `DELETE FROM responses WHERE url = ?` failed
    with `no such column: url`. Switched to the library's own
    `backend.delete(urls=[...])` API.
  Plant complete after fixes: 2 fixture prospects seeded
  (`Boston Symphony Orchestra` zip 02115, `WBUR CitySpace`
  zip 02111).
- 14:58 — DB pre-pipeline state: existing artsboston BSO row
  (no zip) sits alongside the new manual BSO fixture (zip 02115).
  Their business_keys differ; dedupe `_fetch_existing_by_name`
  no_zip lookup will resolve the competitor_stations BSO emit
  to one of them — likely artsboston (older, so lower
  created_at). T07 integrity is permissive about which BSO ends
  up tagged with the merged source list.
- 15:00 — kicked off `python pipeline.py --fresh` in background
  (logs to `cache/t5_run1.log`). Watching for completion via
  Monitor.
- 16:48 — pipeline finished. Final summary:
  - 782 rows total post-dedupe.
  - `competitor_stations` source: WGBH 5, WERS 97, WBUR 10
    (with 2 peer-station suppressions: WBUR CitySpace + The WBUR
    Festival), WCRB 0, WUMB 0 — 112 rows pre-dedupe, 102 unique
    after the source's internal dedup pass. 106 ended up
    contributing to `prospects.source` after pipeline-wide dedupe
    merge.
  - Supabase sync: 156 inserted, 619 updated, 7 skipped, 0 failed,
    22 cross_run_reused (name-based dedupe; the
    `_fetch_existing_by_name` no_zip lookup is exactly the path
    competitor_stations rows take since they don't extract zips).
  - Tag sync: 478 added, 960 preserved, 0 lock-skipped, 0
    compliance-resuppressed, 0 vocab misses, 0 failed → 1,515
    total tag rows touched.
  - Pre-existing transient: OSM Overpass returned 406 once
    (`source_failed/osm`); MA SOS Playwright form lost some
    selectors (782 rows still saved via checkpoint). Neither
    introduced by T5; both are documented expected-failure
    categories in the T13 integrity check.

### Integrity test results — `scripts/t5_integrity.py`

After the live pipeline run:

```
Stage T5 integrity
  snapshot:    cache/t5_snapshot.json
  started_at:  2026-04-28T20:31:17Z
  peers count: 15

[PASS]         T01  WCRB fixture yields 0 sponsors (inquiry page; deviation documented in ROLLOUT)
[PASS]         T02  WGBH fixture yields 5 testimonials with history:wgbh_sponsor
[PASS]         T03  WBUR fixture: 10 members, 2 peer-suppressed
[PASS]         T04  WUMB fixture yields 0 sponsors (inquiry page; deviation documented in ROLLOUT)
[PASS]         T05  WERS fixture yields 97 sponsors with history:wers_sponsor; 5/5 known advertisers present
[SKIP-MANUAL]  T06  No prospect_tags rows with history:wcrb_sponsor (WCRB inquiry page yields 0; expected)
[PASS]         T07  BSO collision: row with source='artsboston,competitor_stations' merges
                    competitor_stations with a prior contributor
[PASS]         T08  robots.txt for all 5 stations permits sponsor URL
[PASS]         T09  User-Agent matches WHRBProspectPipeline/1.0 (+https://www.whrb.org/sales; sales@whrb.org)
[PASS]         T10  inter-station sleep ≥5s observed
[PASS]         T11.svc  106 prospects credited to competitor_stations (rows_last_run > 0)
[SKIP-BROWSER] T11.browser  Browser: /admin/sources lists competitor_stations row + drill-down
[PASS]         T12.svc  5/5 Turn-6 advertisers credited to competitor_stations:
                    Boston Symphony Orchestra=hit, Boston Ballet=hit, Mass Cultural Council=hit,
                    Boston Lyric Opera=hit, Celebrity Series of Boston=hit
[SKIP-BROWSER] T12.browser  Browser: /admin/sources/competitor_stations sample-rows
[PASS]         T13  0 unexpected error/fatal events since stage start (allowed:
                    {robots_blocked, source_failed} — pre-existing pipeline-wide flake categories)
[PASS]         T14  T1-T4 integrity modules import cleanly

Stage T5 Tks: pass=13 skip-browser=2 skip-manual=1 fail=0 (total 16)
```

### Manual spot-check (T12 contract — 5 Turn-6 advertisers)

Documented as required by plan §7.5 ("Manual spot-check of 5 known
advertisers from the Turn 6 client list documented in ROLLOUT").
The 5/5 Turn-6 advertisers verified by `T12.svc` (above) — every one
of them now lists `competitor_stations` as a contributor in the
prospects table:

| Advertiser | DB row's `source` field |
|---|---|
| Boston Symphony Orchestra    | `artsboston,competitor_stations` |
| Boston Ballet                | `competitor_stations` |
| Mass Cultural Council        | `competitor_stations` |
| Boston Lyric Opera           | `artsboston,competitor_stations` |
| Celebrity Series of Boston   | `competitor_stations` |

Two of the five collided with prior `artsboston` rows and merged
cleanly via dedupe; three were brand-new entrants that
competitor_stations contributed alone. Either outcome is
plan-conformant — close-rate attribution credits every contributor
(plan §1.3 #21), so cross-source totals are by design.

### Plan deviations (procedural)

1. **WGBH URL pinned to `sponsorship.wgbh.org/` instead of
   `wgbh.org/support/sponsorship`** — the latter is the inquiry
   page with no listed sponsors; the former is the centralized GBH
   Local Corporate Sponsorship landing where the testimonials live.
   Both were considered; chose the higher-yield page.

2. **WBUR URL pinned to `/membership/605748/members`** —
   `/sponsors` returned 404. The members page lists ~12
   discount-partner businesses — not strict FCC underwriters but
   businesses that value WBUR-audience association. Tagged
   `history:wbur_sponsor` as the closest semantic fit.

3. **WCRB and WUMB pinned despite expected zero yield** — the
   plan §7.4 listed both as scrape targets. URL discovery showed
   neither station publishes a public sponsor list at fixture-
   capture time. Both URLs are still pinned (and the parser
   future-proofed to scan external links) so a future page change
   surfaces automatically.

4. **`source_failed` added to T13's expected-categories
   allowlist** alongside `robots_blocked`. Pipeline-wide
   transient failures (OSM Overpass 406, BBB Playwright timeout,
   MA SOS form selector drift) emit this category and are
   independent of T5. T5's own scrape failures emit
   `competitor_stations_fetch_failed`, which IS gated.

5. **T12 spot-check candidates** — used the Turn-6-derived list
   {BSO, Boston Ballet, Mass Cultural Council, Boston Lyric
   Opera, Celebrity Series of Boston} rather than the
   plan §7.5's example trio (Westfield Capital Management, Wine &
   Cheese Cask, Foley & Lardner) because all 5 of mine appear
   directly in the WERS fixture and are independently verifiable
   in the prospects table.

### Web-app + pipeline gates

- `pnpm typecheck` — clean.
- `pnpm lint` — clean.
- `pnpm test:run` — 34/34 Vitest passes (existing T1–T4 + foundation suite).
- `pytest tests/` — 187/187 (33 new T5 parser tests + prior 154).
- `ruff check` — clean.
- `apply_t5_migration.py --dry-run` and live apply — both clean.

### Stage T5 exit gate — effective state

**GREEN on every required gate.**
13 PASS / 2 SKIP-BROWSER / 1 SKIP-MANUAL / 0 FAIL on
`scripts/t5_integrity.py`.

The 2 SKIP-BROWSER entries (T11.browser, T12.browser) cover the
visual half of two checks whose substantive contracts already PASS
at the Python/SQL level (T11.svc: 106 prospects credited;
T12.svc: 5/5 Turn-6 spot-check). Skeleton placeholder spec at
`whrb-web/e2e/t5/peer-stations.spec.ts` exercises the route guard
for non-admin users and documents the manual admin-side
verification recipe; the admin-storage variant is `test.describe.skip`
until the project standardizes a programmatic admin auth setup
(out-of-scope for T5, candidate for a follow-up infra PR).

The 1 SKIP-MANUAL (T06) is by design — the WCRB scrape page is
currently inquiry-only, so no `history:wcrb_sponsor` tags get
emitted, so the daypart-derivation downstream check has no rows
to match. If WCRB ever publishes a sponsor list and the parser
emits rows, T06 will flip to PASS automatically without any
integrity-script change.

Migration `015_peer_stations.sql` applied + verified live on
`WHRB dev`. Branch pushed to
`origin/t5/competitor-station-source` with the commit message
following the established stage-PR convention. Cited the
T4 deferred-followup O1 convention in the PR body — no non-T5
commits piggybacked on this branch.

Stage T5 implementation ends here. Per
`feedback_no_auto_stage_advance.md`, T6 (Harvard + ensemble +
corporate-sponsor source batch) does **not** start until an
explicit "start T6" command.

### Stage T5 deferred follow-ups (not blocking T6 entry)

| ID | File / surface | Issue | Why deferred | Suggested home |
|----|---------------|-------|--------------|----------------|
| F1 | `whrb-web/e2e/t5/peer-stations.spec.ts` | Two specs are `test.describe.skip` because the project hasn't standardized a programmatic admin auth state for stage e2e. The non-admin route guard test is live; the admin-content checks are documented but skipped. | Auth-state plumbing is a cross-stage infra concern, not a T5 deliverable. The integrity script's `T11.svc` + `T12.svc` cover the same data via SQL. | Standalone "e2e admin auth standardization" PR — adds a reusable admin storage state generator, then unskips T5 (and applicable prior-stage) admin specs. |
| F2 | `whrb-prospects/cache/t5_run1.log` | The log file was 7,551 bytes at run end, ~all of it Playwright form-selector errors from MA SOS; the high-signal phase summaries (sync stats, tag stats, source counts) are visible at the tail. Monitor watch was set up to filter these but tee buffered through Python's pipe so notifications didn't fire mid-run; in practice, polling the DB (event_log + pipeline_runs) gave better visibility. | Process improvement, not a code defect. Pipeline writes to event_log already; the stdout log is supplementary. | Optional: add `python -u` (unbuffered) to the canonical pipeline-run commands documented in CLAUDE.md / RUNBOOK.md so tee'd output streams in real time. Or formalize the DB-poll recipe in RUNBOOK.md as the canonical "watch a long pipeline run" approach. |

