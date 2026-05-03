# Pre-Stage-6 prep (2026-04-19, post-Stage-5.5 / post-Stage-6a)

Captured per the companion plan's §15 round-2 clarifications. Logged here so the Stage 6
entry state is explicit. Nothing below has been executed yet — it records the agreed-upon
entry plan.

### Branch + workflow

- **Stage 5.5 PR** ([#5](https://github.com/CountCowy/whrb-prospects/pull/5)) merged to
  `main` (2026-04-19); **Stage 6a** landed directly on `main` at `4c1a31a`.
- **Stage 6 branch:** `stage6/read-only-views` forks from `origin/main` at `4c1a31a` in the
  top-level `Listing/` checkout (not from a worktree). Switch to the stage-off-main pattern
  established by §2 decision 1 of the companion plan — stage-to-stage forking retired.
- **Commit cadence:** one consolidated commit once all 24 integrity checks are green.
- **PR:** open `stage6/read-only-views` → `main` at exit.

### Deps + tooling

- **New npm deps (in `whrb-web/`):** `@tanstack/react-table` (mandated by plan §4.2) and
  `zod` (server-side body validation for `/api/feedback` + pattern-setting for Stage 7 API
  routes). No other new deps — `lucide-react`, `date-fns-tz`, `sonner`, Tailwind v4 all
  already present.

### Integrity targets

- **Playwright + `stage6_integrity.py`** must pass in BOTH environments:
  - (1) Local `pnpm dev` on `http://localhost:3000`.
  - (2) Vercel preview deploy once the branch is pushed.
- **Preflight (§3.5):** before writing any Stage 6 code, run `stage5_integrity.py --deploy-url
  <latest-preview>` and `pnpm e2e` (Stage 6a smoke spec). Both must be green; any regression
  blocks Stage 6.

### Decisions tightening plan §4

- **Sort tiebreaker (plan T03):** default All Prospects order is
  `priority_score DESC NULLS LAST, id ASC`. The `id ASC` tiebreaker keeps the
  "first 100 IDs match SQL" assertion deterministic when `priority_score` ties (the current
  2,935-row dataset has many ties at score 30 / 15 / etc.).
- **Stage-start reference timestamp (plan T23):** `stage6_plant.py` writes
  `cache/stage6_snapshot.json` with `{started_at_iso: "<UTC now>"}` at plant time. Both
  `stage6_integrity.py` and the Playwright specs read that value for any
  "since-stage-start" window assertion. Cleanup removes the snapshot.
- **Home-tile count widened to 7** (plan deviation — plan §4.4 said "4–6"): total, tier A,
  unassigned, nonprofit, **my-assigned, with-email, recently-added-7d**. T01 widens to match.
- **Feedback widget scope (plan T22):** floating button on `/`, `/prospects`, `/my`, `/team`
  only — not on `/settings/notifications` and not on any `/admin/**` page.

### Fixtures

- **`stage6_plant.py`** seeds (a) 12 synthetic `prospect_notes` so the home recent-activity
  feed and the Boston Ballet detail subject have non-empty content, and (b) two feedback
  rows (one by the admin, one by a freshly-invited `stage6-rep@example.com` test rep) so
  T20 can exercise RLS isolation. It also records `cache/stage6_snapshot.json` with the
  stage-start UTC timestamp.
- **`stage6_cleanup.py`** (supersedes plan §4.7 — memory-driven): hard-deletes BOTH synthetic
  users — `stage6-rep@example.com` AND `stage6a-smoke@example.com` (Stage 6a Playwright
  user, per the auto-memory note about its missing teardown). Re-running Stage 6a afterwards
  re-creates `stage6a-smoke@example.com` idempotently via `auth.setup.ts`. Cleanup also
  deletes the 12 seeded notes, the two feedback rows, and the snapshot file.

### Detail-page screenshot subject

- **Boston Ballet** canonical seed (Tier A, guaranteed present from Stage 4, meaningful real
  row). Plant seeds 1–2 notes on this exact row so T13 and the screenshot both show the
  read-only notes list non-empty.

### Screenshot set

- Two themes × six scenes, captured manually via chrome-devtools MCP into
  `whrb-prospects/docs/screenshots/stage6/`: Home, All Prospects, My Clients (empty),
  Team, Detail (Boston Ballet, read-only), Feedback widget open.

### DB pre-state trusted

From Stage 4 exit + Stage 5.5 code-quality work: 2,935 `public.prospects` rows (2,933
pipeline + MFA + Boston Ballet seeded), BSO override restored, `event_log` clean of
`level='error'` rows across stages 2–5.5. `prospect_notes` is expected to be empty on entry
(no writes land in Stage 5 or Stage 6a). No empirical re-verification before Stage 6
begins; Stage 6's T01/T02/T16/T23 will surface any drift.

---

