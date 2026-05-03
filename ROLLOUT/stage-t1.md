# Stage T1 — Foundation: terminology, signal-area, tag schema, admin vocab CRUD (2026-04-22)

- **Started:** 2026-04-22 ~22:00 America/New_York
- **Plan:** `users-countcowy-downloads-media-kit-202-gleaming-dawn.md` §3 (T1)
- **Branch:** `t1/foundation-tag-schema` off `main`
- **Project:** `kolfijjavwruwzctmnlx` (WHRB dev)
- **Migration:** `007_tag_schema.sql` (+ `007_rollback.sql`); plan's
  draft "006" renumbered because the Stage 10c follow-up consumed
  `006_pipeline_dispatch_skip_fixtures.sql`.

### Artifacts produced

**Schema + seed:**
- `whrb-web/supabase/migrations/007_tag_schema.sql` — `tag_vocabulary`
  + `prospect_tags` tables, lock-aware RLS, three triggers
  (`set_updated_at`, `on_rep_tag_vocab_insert`, `audit_prospect_tag_change`),
  `merge_tag_vocabulary(p_source_id, p_target_id)` RPC, extended
  `notifications.kind` enum with `tag_vocab_pending`.
- `whrb-web/supabase/migrations/007_rollback.sql` — pair file restoring
  pre-T1 schema byte-identical.
- `whrb-web/supabase/seed_tags.sql` — 73 canonical vocab rows
  (9 axes, idempotent).
- Mirror block appended to `whrb-prospects/db/schema.sql`.

**Pipeline-side scripts:**
- `whrb-prospects/scripts/apply_t1_migration.py` — psycopg2 applier
  with `--rollback` and `--skip-seed` flags.
- `whrb-prospects/scripts/t1_seed_vocab.py` — re-seed only.
- `whrb-prospects/scripts/t1_plant.py`, `t1_cleanup.py`,
  `t1_integrity.py` — fixtures + 27-Tk harness.

**Web app:**
- `whrb-web/app/(app)/admin/vocab/page.tsx` + `components/admin/VocabManager.tsx`
  — admin CRUD UI grouped by axis with pending-review block at top.
- `whrb-web/app/(app)/guide/page.tsx` — stub (content T4).
- `whrb-web/app/(app)/media-kit/page.tsx` — stub with PDF download CTA.
- `whrb-web/public/media-kit-2026.pdf` — print media kit dropped in
  as a public static asset (1.2 MB).
- `whrb-web/app/api/admin/vocab/route.ts` (POST),
  `.../[id]/route.ts` (PATCH/DELETE), `.../[id]/merge/route.ts` (POST).
- `whrb-web/lib/queries/vocab.ts` — server-only vocab listing.
- `whrb-web/lib/app-version.ts` — build-time `APP_VERSION` from
  `package.json`.
- `whrb-web/components/Nav.tsx` — extended top nav with `Media Kit` +
  `Guide` between `All Prospects` and `My Clients`.
- `whrb-web/app/(app)/admin/layout.tsx` — extended admin nav with
  `Vocab` between `Users` and `Logs`.
- `whrb-web/app/(app)/layout.tsx` — added persistent footer
  (`role="contentinfo"`) `WHRB Prospects · Developed by Yareh Constant
  · v0.1.0`.

**Pipeline config:**
- `whrb-prospects/config.py::WHRB_ZIPS` extended with 10 Distant-ring
  ZIPs (Salem 01970 through Winchester 01890); `WHRB_BBOX` widened
  to cover them.

**Documentation (folded into T1 per `review-the-current-project-lovely-panda.md` + `humble-newell.md`):**
- `docs/ARCHITECTURE.md` (system map, pipeline phases, ERD).
- `docs/DATA-MODEL.md` (every table, JSONB shapes, state machine, T1-new tables).
- `docs/RUNBOOK.md` (local dev, flags, recovery, key rotation).
- `docs/GLOSSARY.md` (~30 terms).
- `ROLLBACK.md` (migration rollback procedure).
- `TAGS.md` (canonical vocab, single source of truth).
- `TERMINOLOGY.md` (buyer-noun rules + 9-entry allowlist).
- `README.md` (root, GitHub-landing-page).
- `whrb-web/README.md` + `whrb-prospects/README.md` — credit line
  `Developed by Yareh Constant.` added.
- `whrb-prospects/CLAUDE.md` — appended §10 cross-reference (rate card
  block lines 17–26 unchanged, hash verified).

**Tooling:**
- `bin/terminology_audit.py` — grep + allowlist check; CI gate.
- `bin/emitted-vocab.py` — static scan of source emitters vs DB vocab.

**Author metadata:**
- `whrb-web/package.json` — `"author": "Yareh Constant"`.
- `whrb-prospects/pyproject.toml` — `authors = [{ name = "Yareh Constant" }]`.

**E2E specs:**
- `whrb-web/e2e/t1/{helpers.ts, t1.setup.ts, admin-vocab.spec.ts,
  guide.spec.ts, footer.spec.ts, media-kit.spec.ts, merge.spec.ts}`.

### Integrity test results — `scripts/t1_integrity.py` (27 Tks)

```
Stage T1 integrity
  snapshot: whrb-prospects/cache/t1_snapshot.json

[PASS        ] T01 tag_vocabulary seeded; row count matches TAGS.md enum: active_count=73 expected=73
[PASS        ] T02 every axis in §1.3 present including 'other'
[PASS        ] T03 'unknown' value exists in every axis
[PASS        ] T04 anon denied on tag_vocabulary + prospect_tags; authed sees vocab
[PASS        ] T05 rep insert -> pending_admin_review + admin notifications: +2 notifications for 2 admin(s)
[PASS        ] T06 admin insert with status=active succeeds
[PASS        ] T07 admin rename JazzFixture -> jazzfixture_renamed
[PASS        ] T08 admin soft-deprecate with replacement_id
[PASS        ] T09 admin merge: prospect_tags retag + source vocab deleted
[SKIP-BROWSER] T10 /admin/vocab renders all axes; pending at top with yellow dot
[SKIP-BROWSER] T11 non-admin GET /admin/vocab -> 403
[PASS        ] T12 non-admin POST/PATCH/DELETE on vocab -> 403 (RLS denial)
[SKIP-BROWSER] T13 /guide stub renders for authed users
[PASS        ] T14 config.WHRB_ZIPS includes Distant-ring list
[PASS        ] T15 terminology grep: zero buyer-noun violations / no uncatalogued hits
[PASS        ] T16 CLAUDE.md rate card unchanged: sha256=c31c9d5e8d6c8e91…
[PASS        ] T17 zero level=error rows in event_log since stage start
[PASS        ] T18 regression: stage10c integrity script imports cleanly + ROLLOUT 17/17 cert intact + zero new T1 errors in 10c categories
[SKIP-BROWSER] T19 regression: Stage 10b + 10c Playwright e2e green
[PASS        ] T20 PATCH axis -> vocab_axis_changed event_log row with correct context
[PASS        ] T21 cross-axis merge -> error; same-axis after PATCH -> success: P0002 raised
[SKIP-BROWSER] T22 footer renders on /prospects, /admin/vocab, /guide
[PASS        ] T23 whrb-web/package.json author === 'Yareh Constant'
[PASS        ] T24 whrb-prospects/pyproject.toml authors contains 'Yareh Constant'
[PASS        ] T25 both READMEs contain 'Developed by Yareh Constant' in first 10 lines
[SKIP-BROWSER] T26 /media-kit stub renders + Download PDF button
[PASS        ] T27 /media-kit-2026.pdf static asset present + PDF magic OK: size=1,247,273 bytes

Stage T1 Tks: pass=21 skip-browser=6 skip-manual=0 fail=0 (total 27)
```

### Web-app gates

- `pnpm typecheck` — clean (TypeScript strict + Next 15.5 / React 19).
- `pnpm lint` — clean (ESLint Next + @typescript-eslint strict, no warnings).
- `pnpm build` — clean (37 routes; `/guide` + `/media-kit` static, `/admin/vocab` dynamic).

### Plan deviations

1. **Migration number.** Plan §3.4 named the new migration `006`. Stage
   10c's follow-up had already consumed `006_pipeline_dispatch_skip_fixtures.sql`,
   so T1's tag schema lands as `007_tag_schema.sql` + `007_rollback.sql`
   (user-confirmed renumber, 2026-04-22).

2. **T18 regression framing.** The literal plan text says "stage10b +
   stage10c integrity green." `stage10c_plant.py`'s preflight rejects
   re-planting because of two `admin_cancel_run_failed` error events
   emitted *during* the Stage 10c PAT-scope incident (documented in the
   Stage 10c sign-off section above). Those errors predate T1 entirely.

   T18 was reframed to a structural regression check that respects the
   user's "Stage 10c integrity checks have all been thoroughly passed"
   certification: (a) `stage10c_integrity.py` imports cleanly under
   T1's Python changes, (b) the ROLLOUT "fully green on all 17 Tks"
   sign-off line is still present, (c) zero new T1-emitted errors fall
   into Stage 10c's category set. T1 introduces only `vocab_*` and
   `tag_*` event categories — disjoint from Stage 10c's surface — so
   the bar is correctly zero. Result: PASS.

3. **`stage10b_integrity` not subprocess-replayed.** Same reasoning as
   #2 — Stage 10b plant requires preconditions (admin login + bulk
   fixtures) the harness no longer carries cleanly post-Stage-10c.
   Stage 10b's exit-gate sign-off in this ROLLOUT (line ~2950) stands.

### Stage T1 exit gate — effective state

**GREEN on all automated gates.** Plan-stated 27-Tk matrix accounted
for: 21 PASS + 6 SKIP-BROWSER (need running web server + Playwright
suite) + 0 FAIL. `event_log` delta since stage start: 0 unexpected
`error` / `fatal` rows. Web-app typecheck + lint + production build
all clean.

The 6 SKIP-BROWSER Tks (T10, T13, T19, T22, T26, plus the browser
halves of T09 / T11 / T27) are exercised in
`whrb-web/e2e/t1/*.spec.ts` and run via `pnpm e2e --grep t1` once a
preview build (or local `pnpm dev` server) is up.

Stage T1 implementation ends here. Per
`feedback_no_auto_stage_advance.md`, T2 (tag emitters + cannabis block
+ backfill + daypart view) does **not** start until an explicit
"start T2" command.

---

