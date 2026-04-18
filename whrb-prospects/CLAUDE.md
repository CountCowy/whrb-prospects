# CLAUDE.md — WHRB Prospect Pipeline Session Notes

This file is a handoff summary for the next Claude session working on `whrb-prospects`. It captures what the project does, the architecture, what has been done across several sessions, and exactly what is still pending.

---

## 1. Project at a Glance

### 1.1 Who this is for
The user is a **sales associate at WHRB 95.3 FM** (Harvard Radio Broadcasting, whrb.org) — a non-commercial educational (**NCE**) Harvard-affiliated station broadcasting at ~3,000 W from Cambridge with strong signal across Cambridge, Boston, Brookline, Somerville, and inner-ring suburbs; streams globally.

Because WHRB is NCE-licensed, "ads" are legally **FCC-compliant underwriting announcements** — not direct-response commercials. Sponsors buy **brand association**, not attribution or ROAS. This is the single most important fact shaping the ICP: it filters *out* anyone who needs measurable conversions in 30 days, and filters *in* brands that want to be seen next to BSO / MFA / Harvard.

### 1.2 The goal in one sentence
Build a **Boston-area ad-sales prospect list** by scraping multiple free/open data sources, enriching with contact info (email/phone/owner name), deduplicating, scoring against a tier system, and emitting a CSV the associate can dial through.

### 1.3 Pricing → why the tier system exists
Confirmed rate card (user-supplied):

| Daypart | 30s spot | 60s spot |
|---|---|---|
| Classical (peak) | $60 | $75 |
| Jazz / Blues / Hillbillies | $45 | $60 |
| Record Hospital / The Darker Side | $30 | $45 |

**Typical package range: $100 – $3,000.** This is the critical number. It means the funnel is **SMB-accessible** — a landscaper can buy 3–5 spots for under $200 — not just institutional. That's why the pipeline deliberately reaches down into home-services contractors (Tier C), not just symphony-grade sponsors.

### 1.4 Audience skew (drives who fits)
- **Classical / Jazz dayparts:** 45+, affluent, "donor-class," educated, culturally engaged, often Harvard-affiliated.
- **Underground Rock / Record Hospital / Darker Side:** college-age through mid-30s.
- **Sports / news:** Harvard alumni, students, faculty, staff.
- **Hillbilly at Harvard / Blues Hangover:** enthusiast niches with disproportionate loyalty.

### 1.5 ICP — the three tiers the pipeline sources into
**Tier A — Anchor sponsors ($1,500–$3,000 packages, multi-week flights, annual renewals)**
- Cultural & arts institutions: BSO, Handel and Haydn, Boston Lyric Opera, Celebrity Series, Boston Early Music Festival, A.R.T., Huntington, MFA, Isabella Stewart Gardner, Harvard Art Museums, ICA, Boston Ballet.
- Premium retail tied to the audience: Shreve Crump & Low, Goodwin's High End, M. Steinert, Johnson String, Long's Jewelers.
- Senior living CCRCs (Brookhaven, Orchard Cove, NewBridge, 2Life).
- Wealth management, private banking, estate law, concierge medicine, audiology.
- Private K–12 + continuing ed (BB&N, Shady Hill, Milton, Winsor; Harvard Extension, Longy, NEC, Berklee).

**Tier B — Mid-market local ($300–$1,500)**
- Independent restaurants / bars across Cambridge, Somerville, Brookline, Back Bay, South End (Felipe's, Giulia, Oleana, Craigie, Area Four, Alden & Harlow, etc.).
- Boutique retail (Good Vibrations, Black Ink, Leavitt & Peirce, Cardullo's, Grolier, Raven).
- Fitness studios, dentists / orthodontists / vets / optometrists with 1–2 locations.
- Auto repair, bike shops, framers, printers, tailors, music teachers, tutors, individual realtors.

**Tier C — Micro-local home services ($100–$500 entry packages)**
- Landscaping, snow removal, tree, painting, roofing, HVAC, plumbing, electrical, handymen, cleaning, pest, movers, pool, masonry, pet services, tax prep, driving instructors.
- **Highly seasonal** — ideal outreach windows are 6–8 weeks before peak demand. This is why the pipeline pulls the MA HIC registry and city contractor licenses; the sales motion is a *calendar* business.

### 1.6 Firmographic filters baked into the sources
- Greater Boston ZIP bias: **02138–02145, 02446, 02445, 02215, 02116, 02118, 02130** (WHRB's strong-signal zone).
- Independently owned, or local franchise with marketing autonomy.
- Tier C floor: owner-operator or <20 employees, already advertising somewhere (Google, Yelp, Nextdoor, truck wraps) — proves they have a budget.
- Existing brand-building habit (event sponsorships, newsletter, *Boston Magazine* / *Improper* ads, WCRB/WGBH underwriting) is a strong positive.

### 1.7 Explicit disqualifiers
- National chains with centralized media buying and no local discretion.
- Direct-response verticals (used car, mattress, injury law) — FCC underwriting rules prohibit calls to action, price mentions, and comparatives.
- Businesses whose customer is <25 and mobile-first — IG/TikTok will beat broadcast.
- Anyone demanding 30-day conversion attribution.

### 1.8 Why each source was picked
The source modules in `sources/` map directly to the ICP:

| Source | Tier served | Rationale |
|---|---|---|
| `chambers.py` (HSBA + ArtsBoston) | A, B | HSBA = pre-filtered Harvard Square ICP. ArtsBoston = cultural Tier A in one directory. |
| `city_licenses.py` (Cambridge / Somerville / Boston) | B, C | New businesses hungriest for ads; contractor + food licenses = Tier B/C base. |
| `ma_hic.py` | C | Every licensed home-improvement contractor in MA — Tier C in one file. |
| `osm_overpass.py` | B | OSM categories (restaurants, retail, fitness) scoped to Boston ZIPs. |
| `yelp_fusion.py` | B | Better for Boston restaurants / personal services than Google. |
| `ma_sos.py` | A, B | Secretary of State filings → decision-maker names for cold outreach. |
| `bbb.py` | A, B | Accredited-business list as a "cares about reputation + has budget" proxy. |
| `program_books.py` | A | Sponsors listed in BSO / H+H / A.R.T. programs *already pay for this audience*. |
| `best_of_boston.py` | B | *Boston Magazine* Best of Boston winners — verified quality signal. Currently stubbed (site returns 403). |

### 1.9 System shape
- **Entry point:** `pipeline.py` (argparse CLI orchestrator).
- **Output:** `output/whrb_prospects.csv`.
- **Runtime:** Python 3, venv at `.venv/`, deps in `requirements.txt`.
- **Side stack:** `requests-cache` (sqlite, 24h TTL), custom two-layer checkpointing, `tenacity` smart retry, `httpx` async for contact enrichment, `playwright` for JS sites, `rapidfuzz` for dedupe, `pdfplumber` for program-book PDFs.

### Top-level layout
```
whrb-prospects/
├── pipeline.py                # orchestrator (argparse, caching, checkpoints)
├── config.py                  # tier definitions, OSM queries, score weights
├── sources/                   # one module per data source
│   ├── chambers.py            # HSBA + ArtsBoston scrapers (Tier A)
│   ├── city_licenses.py       # Cambridge/Somerville Socrata + Boston CKAN
│   ├── osm_overpass.py        # OpenStreetMap Overpass API
│   ├── yelp_fusion.py         # Yelp Fusion API (optional)
│   ├── ma_hic.py              # MA Home Improvement Contractors
│   ├── ma_sos.py              # MA Secretary of State (Playwright)
│   ├── bbb.py                 # Better Business Bureau (Playwright, flaky)
│   ├── best_of_boston.py      # STUBBED — site returns 403
│   ├── program_books.py       # PDF sponsor extraction
│   └── program_books_fetcher.py
├── enrich/
│   ├── hunter_free.py         # Hunter.io free tier email enrichment
│   ├── apollo_free.py         # Apollo free tier
│   ├── contact_scraper.py     # async httpx scraper for /contact /about
│   ├── email_validate.py
│   └── dedupe.py              # rapidfuzz fuzzy merge
├── util/
│   ├── http.py                # smart_retry + raise_for_smart_status
│   ├── checkpoint.py          # two-layer JSON checkpointing
│   └── normalize.py           # normalize_website() unwraps Socrata dicts
├── cache/                     # requests-cache sqlite + checkpoint JSON
├── data/                      # intermediate pickles
└── output/                    # final CSV
```

---

## 2. Tier System (from `config.py`)

- **Tier A** — Arts orgs, cultural institutions, premium/luxury brands. Highest ad-sales value.
- **Tier B** — Restaurants, boutiques, professional services.
- **Tier C** — Home-services contractors, long-tail. Low priority.
- `SCORE_WEIGHTS`: `tier_A=30`, `tier_B=15`, `tier_C=5` + modifiers.
- `OSM_QUERIES` per tier drive Overpass queries.

---

## 3. Work Completed Across Prior Sessions

### Phase 1 — Performance (✅ done)
1. Disabled flaky sources (`best_of_boston` stubbed to `[]`, BBB behind `--with-bbb`).
2. Async contact scraping in `enrich/contact_scraper.py` using `httpx.AsyncClient`, 40-concurrent semaphore, 3 candidate paths (`/`, `/contact`, `/about`), early exit on email found.
3. HTTP caching: `requests-cache` installed at pipeline start (sqlite at `cache/http_cache.sqlite`, 24h TTL).
4. Stale URLs fixed in sources.
5. Smart retry in `util/http.py`:
   - `smart_retry` decorator wraps tenacity
   - `raise_for_smart_status()` classifies `4xx` → `NonRetryableHTTPError`, `5xx`/`429` → `RetryableHTTPError`
   - Migrated: `osm_overpass`, `yelp_fusion`, `ma_hic`, `program_books_fetcher`.
6. `ma_sos.py` refactored: persistent Playwright browser, `_lookup_on_page(page, name)`, default limit 25.

### Phase 2 — Checkpointing (✅ done)
- `util/checkpoint.py` provides two layers:
  - **Source-level**: `save_source(name, rows)` / `load_source(name)` — per-scraper output cache.
  - **Phase-level**: `save_phase(phase_name, state)` / `load_latest()` — resume between major pipeline phases.
- Atomic writes (`tmp` + `os.rename`), **24-hour TTL** on stored JSON.
- `pipeline.py` has a `PHASE_ORDER` list and resume-from-last-completed-phase logic.
- CLI flag `--fresh` clears checkpoints and forces a full rerun.
- `_safe()` wrapper replaced by `_safe_cached()` which consults the source cache first.

### Phase 3 — Data Quality Fixes (✅ done)
Eight issues were found by inspecting `output/whrb_prospects.csv`. All implemented:

| # | Issue | Status |
|---|-------|--------|
| 1 | All HSBA rows share Bill Manley's contact info | ✅ done |
| 2 | ArtsBoston returning 0 rows | ✅ done |
| 3 | `boston_food` has no phone mapping | ✅ done |
| 4 | `program_books` captures financial-report noise | ✅ done |
| 5 | (merged into #2) | ✅ |
| 6 | `boston_food` dominates output (Tier B, no phone filter, uncapped) | ✅ done |
| 7 | `dedupe._merge` silently drops fields; line 72 ignores return; ZIP-less matches too loose | ✅ done |
| 8 | (merged into #2) | ✅ |

Implementation details:
- `sources/city_licenses.py::_fetch_boston_food()` — maps `dayphn_cleaned`→`company_phone`, requires phone, Tier demoted **B→C**, capped at **500 rows** via `BOSTON_FOOD_MAX_ROWS`.
- `sources/program_books.py` — `NAME_RE` tightened to require ≥2 uppercase words; added `FILENAME_EXCLUDE` (financial/annual-report/form-990/...), `SPONSOR_CONTEXT_MARKERS` page gating, and `NAME_BLOCKLIST` for station/venue boilerplate; length 6–80.
- `enrich/dedupe.py` — new `CONFLICT_PRESERVE_FIELDS` preserves loser's divergent values under `alt_<field>`; `_best_tier()` with `TIER_RANK={A:3,B:2,C:1}` resolves tier independently of completeness; `_fuzz_threshold()` returns **92 when ZIPs match, 97 when either is missing**; fuzzy-pass call site captures `_merge`'s return value and replaces the list slot in place (fixes the line-72 bug).

---

## 4. Architectural Intricacies to Know

### 4.1 Socrata URL-type fields
Cambridge/Somerville open-data APIs return URL fields as dicts:
```python
{"url": "https://example.com", "description": "..."}
```
This caused `AttributeError: 'dict' object has no attribute 'startswith'` in `hunter_free.py`. Three fixes applied:
1. `city_licenses._pick()` unwraps dicts to `url` key.
2. `util/normalize.py::normalize_website()` — canonical helper.
3. `enrich/hunter_free.py` and `enrich/contact_scraper.py` call `normalize_website()` before `urlparse`.

**Always** pass scraped websites through `normalize_website()` before string ops.

### 4.2 HSBA two-pass scrape (`sources/chambers.py`)
- Originally every HSBA row's `website` was `harvardsquare.com/biz/<slug>` — a directory page — so contact scraper pulled Bill Manley's info 324× over.
- Now: `_scrape_hsba()` first collects names+detail-URLs from listing pages, then `_scrape_hsba_detail(url)` hits each detail page to extract:
  - Real business website from `<a>` whose visible text is "Website".
  - Phone from `<a href="tel:...">`.
  - Address from JSON-LD `LocalBusiness`.
- 0.3s delay between detail fetches.

### 4.3 ArtsBoston selectors
Site uses Jupiter WordPress theme — old CSS selectors didn't match. Now uses broad `a[href^="http"]` with:
```python
SOCIAL_DOMAINS = (
    "facebook.com", "twitter.com", "instagram.com", "youtube.com",
    "linkedin.com", "tiktok.com", "pinterest.com", "yelp.com",
    "tripadvisor.com",
)
```
Filters out social links and `artsboston.org` self-links.

### 4.4 Checkpoint TTL
Checkpoints expire at 24h. If you see "stale checkpoint, re-running" on a run you thought was resuming, that's why. Use `--fresh` intentionally; otherwise respect the resume.

---

## 5. Phase 4 — Web Interface (📋 planned, not yet built)

The approved implementation plan lives at **`/Users/countcowy/.claude/plans/soft-crafting-tulip.md`** — the Clarifications addendums at the top of that file (rounds 1–5, all dated 2026-04-17) are the authoritative source of truth and supersede any earlier text in the same document. Read them before touching anything.

### 5.1 Goal
Replace the single-user CSV workflow with a multi-user, mobile-responsive web app for the WHRB sales team (**10–20 reps**, Harvard student org) so they can claim prospects, track each one's sales state, leave notes, and correct scraped data — without those edits being overwritten when the pipeline reruns (expected cadence: **multiple times per month**; CSV currently produces **~2,976 rows**). Max-polish rollout: custom domain, custom-branded transactional email, presence indicators, per-user notification preferences, bulk admin actions, CSV/XLSX export, Harvard Crimson accent, Activity tab.

### 5.2 Stack
- **Frontend:** Next.js 15 App Router + React 19 + TypeScript + Tailwind (`darkMode:'class'`) + shadcn/ui + `next-themes` + `@tanstack/react-table` + `lucide-react` + `@dnd-kit/{core,sortable}` (kanban) + `date-fns` + `date-fns-tz` (all timestamps rendered in **America/New_York**) + `sonner` (toasts) + `xlsx` (export) + `resend` (server-side email).
- **Auth + DB:** Supabase Cloud (no local stack) — magic-link auth, Postgres with RLS, Realtime subscriptions on `prospects`, `prospect_notes`, `pipeline_runs`, `notifications`, `prospect_presence`. **Resend** SMTP powers all transactional email in prod; dev uses Supabase's built-in SMTP.
- **Deployment:** Vercel for `whrb-web/` pointed at the monorepo subdirectory; pipeline runs via **GitHub Actions** (both `repository_dispatch` from the web UI and a monthly cron).
- **Two cloud projects** (branching abandoned — it's a Pro-tier feature):
  - **Dev:** `WHRB dev` at `https://kolfijjavwruwzctmnlx.supabase.co`. Credentials for this project live in the plan's clarifications addendum (round 5) and in local `.env` files (gitignored, never committed).
  - **Prod:** second Supabase project created at Stage 11 cutover.
- **Monorepo:** one git repo contains both `whrb-prospects/` (pipeline) and `whrb-web/` (Next.js app). The Actions workflow for the pipeline sets `working-directory: whrb-prospects`; Vercel is pointed at `whrb-web/`.

### 5.3 Repo layout after build
```
<monorepo-root>/
├── whrb-prospects/                     # existing Python pipeline + additions
│   ├── db/                             # NEW
│   │   ├── supabase_sync.py            # 08_supabase_sync phase — upsert w/ edit-lock
│   │   ├── nonprofit_bmf.py            # IRS BMF enrichment pass (07a)
│   │   └── schema.sql                  # mirror of supabase/migrations/000_init.sql
│   ├── util/
│   │   └── event_log.py                # NEW — batched logger → event_log table
│   └── scripts/                        # NEW
│       ├── rls_check.py                # Stage 1 RLS verifier (20/20 pass)
│       ├── stage7_lock_matrix.py       # Stage 7 15-field lock matrix
│       └── postrun_check.py            # Stage 8/11 edit-preservation diff
├── whrb-web/                           # NEW — Next.js 15 app
│   ├── app/(auth)/login/
│   ├── app/(app)/
│   │   ├── page.tsx                    # HOME
│   │   ├── prospects/                  # ALL PROSPECTS (full list, default sort priority_score DESC)
│   │   ├── my/                         # MY CLIENTS (kanban + table toggle, mobile-collapsible)
│   │   ├── team/                       # TEAM (directory)
│   │   ├── settings/notifications/     # per-user toast/email toggles
│   │   └── admin/{sources,runs,users,logs,feedback,prospects/bulk}/
│   ├── app/api/                        # see plan for full route list
│   ├── components/{ProspectTable, KanbanBoard, NotesPanel, AssignPicker,
│                    PresenceChips, NotificationBell, ExportButton,
│                    BulkActionBar, FeedbackWidget, ThemeToggle, ErrorBoundary}
│   ├── lib/{supabase/{client,server,service}, logging/{client,server}}
│   └── supabase/migrations/000_init.sql
└── .github/workflows/run-pipeline.yml  # repository_dispatch + monthly cron
```

### 5.4 Database — 10 tables
1. **`profiles`** — extends `auth.users`, `role ∈ {admin, rep}`. Populated by `on_auth_user_created` trigger on first login.
2. **`prospects`** — mirrors `pipeline.py::CSV_COLUMNS` *plus* user-facing fields (`state`, `is_nonprofit`, `nonprofit_source`, `ein`, `assigned_to`, `user_overrides` jsonb edit-lock, `alt_fields` jsonb for dedupe conflicts, `pipeline_last_seen_at`, `created_source`). `priority_score` is **server-side indexed** (default sort). Column rename: CSV's `notes` → DB's `pipeline_notes` (pipeline-owned, not user-editable).
3. **`prospect_notes`** — soft-delete with `deleted_at` + `deleted_by` + `edited_at`. Non-admins never see deleted rows; admins see a ghost row with the body recoverable.
4. **`source_config`** — admin-editable enable/disable per scraper.
5. **`pipeline_runs`** — audit + queue (`queued → running → success|failed`).
6. **`event_log`** — unified stream from pipeline + web server + web client.
7. **`feedback`** — feedback widget + admin triage flow.
8. **`user_preferences`** — per-user toggles for notification toast/email.
9. **`notifications`** — recipient-scoped inbox; Realtime-backed; driven by per-user prefs.
10. **`prospect_presence`** — heartbeat rows for kanban's "someone's viewing this" dot.

RLS: read-all-for-authed on most tables; writes scoped to owner/assignee/admin **except** the anyone-to-anyone assignment policy on `prospects`; notes allow author or admin to update/soft-delete; pipeline uses service-role key and bypasses RLS.

**Triggers (in `000_init.sql`):** `on_auth_user_created` (auto-create profile), `set_updated_at` (prospects/source_config/user_preferences), `set_edited_at` (prospect_notes), `audit_prospect_change` (emits `event_log` rows for the Activity tab on every field/state/assignment change).

### 5.5 Pipeline integration — the critical contract
- New final phase `08_supabase_sync` (added to `pipeline.py::PHASE_ORDER`) calls `db/supabase_sync.py::sync(rows)` after the CSV write.
- **`business_key`** = normalized 10-digit phone (preferred) OR `normalized_name|zip`. Reuses `enrich/dedupe.py::_norm_phone` and `::_norm_name` (do not duplicate).
- **Edit-lock via `user_overrides` jsonb**: UI patches write to both the column and `user_overrides[field] = true`. Sync skips any locked field. Lockable field matrix is **15 columns** (see plan Stage 7 integrity tests).
- **Tier, state, assignment, notes, nonprofit override, `priority_score` on user-edited rows** — rules vary, see plan's sync contract.
- Reading `source_config` at pipeline start lets admins disable scrapers via `/admin/sources`.

### 5.6 Nonprofit enrichment
- Phase `07a_nonprofit` between dedupe and sync. Downloads IRS Exempt Organizations Business Master File (MA state extract) monthly to `cache/irs_bmf_ma.csv`. Matches `_norm_name(company_name)` → sets `is_nonprofit=true`, `ein=...`, `nonprofit_source='irs_bmf'`. Manual override sets `nonprofit_source='manual'` and locks via `user_overrides`.
- **`nonprofit_source = 'propublica'`** is a **schema-reserved placeholder only** in v1 — no ProPublica enrichment path is implemented.

### 5.7 UI surfaces
All data-grid pages use the same `ProspectTable` with built-in **search** (debounced server-side `ilike`), **column-visibility toggle** (persisted per-user in `localStorage`), **sticky-first-column horizontal scroll**, **sticky-header vertical scroll**, and 25/50/100/250 pagination. **Default sort on All Prospects is `priority_score DESC`.**

- **Home (`/`)** — greeting + summary tiles + recent-activity feed + shortcuts + feedback panel.
- **All Prospects (`/prospects`)** — master browseable list; admin "+ Add prospect"; export CSV/XLSX.
- **My Clients (`/my`)** — `assigned_to = auth.uid()`; kanban (7 cols on desktop, single-column-with-picker on phone) ⇄ table view. **Any state → any state transition** is allowed (no blocks, even `dead` → `researching`).
- **Team (`/team`)** — directory with assigned/sold counts; click-through filters All Prospects.
- **Prospect detail** — three tabs: **Fields** (inline-editable w/ lock icon), **Notes** (Realtime; author edits/soft-deletes; admin ghost view), **Activity** (chronological audit trail from `event_log` + note lifecycle). Presence chips at the top show avatars of live viewers. Assign picker lets **anyone reassign to anyone**.
- **Settings (`/settings/notifications`)** — per-user toast/email toggles per notification kind.
- **Admin (`/admin/*`)** — `sources`, `runs`, `users` (Supabase Auth admin invite), `logs`, `feedback`, `prospects/bulk` (bulk assign/state/tier/delete with preview+confirm).

### 5.8 Cross-cutting systems
- **Feedback widget:** floating button on every page + inline panel on Home. Admin triage at `/admin/feedback`.
- **Logging:** Python pipeline batched-inserts into `event_log`. Next.js server logs 404s + API exceptions. Browser logs render errors (ErrorBoundary) + unhandled promise rejections. Admin view at `/admin/logs`.
- **Notifications:** assignments (and future kinds) insert `notifications` rows; Realtime delivers toast, Resend delivers email — both gated by `user_preferences`.
- **Presence:** Supabase Realtime Presence channel per prospect + `prospect_presence` heartbeat rows so the kanban can show "viewing now" dots without a channel per card.
- **Export:** CSV/XLSX of the currently-filtered view on All Prospects, My Clients table, and `/admin/logs`. Rate-limited 1/min per user.
- **Dark mode:** `next-themes` with System/Light/Dark toggle. Semantic CSS tokens. Tier colors A=emerald, B=amber, C=slate meet ≥4.5:1 in both themes.
- **Brand accent:** **Harvard Crimson** — `#A51C30` in light mode, lightened `~#C63244` in dark mode — used on primary buttons, focus rings, active nav, links.
- **Timezone:** all user-facing timestamps rendered in `America/New_York` via `date-fns-tz`. DB stores UTC.
- **Mobile responsive:** phone-card layout (<640px), tablet (640–1023px) with hamburger + sticky first column, desktop (≥1024px) full layout. Real-device testing on iOS; Android via BrowserStack / Chrome DevTools emulation.

### 5.9 Twelve-stage rollout with exit gates
**"No stage advances until its exit gate is green"** — see plan for the full test matrix. Per-stage results logged into `ROLLOUT.md` (dev) then `ROLLOUT_PROD.md` (cutover).

Stages at a glance:
1. Cloud provisioning + schema. **`rls_check.py` (Python, in `whrb-prospects/scripts/`) must report 20/20 pass** across 10 tables × {anon-denied, service-role-allowed}. Plus trigger smoke tests for `on_auth_user_created` and `audit_prospect_change`.
2. Pipeline sync + event logging (first ingest ≥ 1,500 rows; ~2,976 expected).
3. **Idempotent rerun** — 3 consecutive runs, 15-field lock test, no-op UPDATEs produce no spurious audit events.
4. Nonprofit BMF enrichment + manual-override persistence.
5. Next.js skeleton + auth + theming (Crimson verified, timezone verified) + logging.
6. Read-only views + shared data grid (default sort `priority_score DESC`) + feedback widget + Team page.
7. Editing + assignment (anyone→anyone) + notes (edit + soft-delete + ghost) + Activity tab + kanban drag-drop (all 42 transitions) + edit-lock UI (15-field matrix).
8. **End-to-end contract test** — `postrun_check.py` must exit 0 after two reruns with real edits.
9. Admin console (sources/runs/users/logs/feedback).
10. `POST /api/pipeline/run` + GitHub Actions worker (`repository_dispatch` + monthly cron).
10b. **Polish pass**: presence indicators, notifications + `/settings/notifications`, `/admin/prospects/bulk`, CSV/XLSX export, mobile responsive across every page.
11. Production cutover — register domain(s), set up Resend, configure `sales.whrb.org`, invite team.

Key principle: **Stage 8 is the contract-verification stage**. If any edit is lost across two reruns, rollout halts until the sync module is fixed.

---

## 6. Pending Tasks — Exact Next Steps (Phase 4 rollout)

Before touching any web code:
1. **Read `/Users/countcowy/.claude/plans/soft-crafting-tulip.md` in full.** The Clarifications addendums (rounds 1–5 at the top) are authoritative and supersede any earlier text in that file.
2. Consult the session todo list for the current stage.
3. Start at Stage 1 (cloud provisioning against the existing `WHRB dev` project at `kolfijjavwruwzctmnlx`) unless the todo list says otherwise.

**Ready-to-implement state (as of 2026-04-17):** Stage 1 has all inputs in hand — Supabase creds (URL / anon / service role) in the plan's round-5 clarifications, admin UUID `d191df5d-a406-4866-a9e2-e0d0aaa00c6b` for `kingyareh@gmail.com` already invited via dashboard, empty project, monorepo decision, `.env` strategy, soft-delete + activity-tab schema all locked in. **Do not implement until the user gives an explicit go-ahead.**

---

## 7. CLI Reference (pipeline)

```
python pipeline.py [flags]

--dry           Tiny smoke run — caps each source at ~5 rows, skips expensive enrichment. Fast sanity check.
--with-hic      Include MA Home Improvement Contractors source.
--with-bbb      Include Better Business Bureau (Playwright, flaky).
--fresh         Ignore and clear any on-disk checkpoints.
```

**Thorough production run:** `python pipeline.py --with-hic` (BBB usually omitted due to flakiness).

Once Phase 4 ships, the pipeline will gain a `--no-supabase` flag for local dry runs that skip the `08_supabase_sync` phase.

---

## 8. Known Errors & Their Fixes (for next-session debug recall)

| Symptom | Cause | Fix location |
|---|---|---|
| `AttributeError: 'dict' object has no attribute 'startswith'` | Socrata URL-type field | `util/normalize.py::normalize_website()` |
| HSBA rows all have the same contact | Website pointed at directory page | `sources/chambers.py::_scrape_hsba_detail` |
| ArtsBoston returns 0 rows | Theme DOM change | `sources/chambers.py` broad `a[href^="http"]` + domain filters |
| Boston food floods output | No phone filter, tier too high, no cap | `sources/city_licenses.py::_fetch_boston_food` (fixed: require phone, Tier C, cap 500) |
| Program-book noise | Over-broad regex + no context gating | `sources/program_books.py` (fixed: filename exclude + sponsor-context + blocklist + ≥2 words) |
| Dedupe loses fields / wrong tier | `_merge` semantics + ignored return | `enrich/dedupe.py` (fixed: `alt_<field>`, `_best_tier`, zip-aware `_fuzz_threshold`, return-value capture) |

---

## 9. When You Resume

**If the immediate task is anything about the web app / UI / Supabase / Next.js:** open `/Users/countcowy/.claude/plans/soft-crafting-tulip.md`, check the session todo list for current stage, and start executing. Each stage has an explicit exit gate — do not advance past it until its integrity tests are green and `ROLLOUT.md` is updated.

**If the task is pipeline data quality:** Phase 3 is done. The next pipeline data task is likely either:
- A full fresh run (`python pipeline.py --fresh --with-hic`) to regenerate `output/whrb_prospects.csv` and verify the Phase 3 fixes hold against real data.
- New sources or enrichment passes — follow the same pattern (`sources/<name>.py` + `smart_retry` + `normalize_website` + source cache via `_safe_cached`).

Spot-check criteria for `output/whrb_prospects.csv` after any pipeline rerun:
- Tier A rows present (Handel & Haydn, BSO, MFA, etc. after ArtsBoston / program_books fixes).
- `boston_food` row count ≤ 500, every row has a phone.
- No duplicated Bill Manley contact info.
- Program-book names look like real sponsor businesses, not financial-report headings.

---

## 10. Files Modified Across Sessions

**Python pipeline — all done:**
- ✅ `sources/chambers.py` — HSBA detail scrape + ArtsBoston selector broadening.
- ✅ `sources/city_licenses.py` — boston_food phone/tier/cap.
- ✅ `sources/program_books.py` — noise filtering.
- ✅ `enrich/dedupe.py` — merge logic overhaul.
- ✅ Phase 1 work: `util/http.py`, `enrich/contact_scraper.py`, `enrich/hunter_free.py`, `sources/{osm_overpass,yelp_fusion,ma_hic,program_books_fetcher,ma_sos,best_of_boston}.py`.
- ✅ Phase 2 work: `util/checkpoint.py`, `util/normalize.py`, `pipeline.py` (checkpoint + caching integration).

**Phase 4 — Stage 1 complete (2026-04-17), Stage 2 pending:**
- ✅ `db/__init__.py`, `db/schema.sql` — created (mirror of `whrb-web/supabase/migrations/000_init.sql`)
- ✅ `scripts/apply_migration.py`, `scripts/rls_check.py`, `scripts/stage1_integrity.py` — created and green (Stage 1 integrity = 10/10, RLS = 20/20)
- ✅ `whrb-web/supabase/migrations/000_init.sql` + `whrb-web/supabase/seed.sql` — created; applied to `WHRB dev`
- ✅ `requirements.txt` — added `supabase>=2.28` + `psycopg2-binary>=2.9` (`postgrest` comes transitively through `supabase`, no separate add needed)
- ✅ `.env` — Supabase dev creds populated (gitignored)
- ✅ Monorepo restructure: `Listing/.git` root with `whrb-prospects/` + `whrb-web/` siblings; `Listing/.gitignore` covers secrets + build artifacts
- ✅ **`notes` → `pipeline_notes` rename** (pre-Stage-2 prep, plan round-6). Touched: `pipeline.py` (`CSV_COLUMNS`, `score()`), `sources/{chambers,city_licenses,ma_hic,bbb,program_books,program_books_fetcher,ma_sos}.py`, `enrich/{apollo_free,hunter_free}.py`. Zero remaining scraped-field `"notes"` dict keys (grep-clean).

- 📋 `db/supabase_sync.py` — Stage 2; upsert-with-edit-lock, seeds `source_config` idempotently at run start
- 📋 `util/event_log.py` — Stage 2; batched `log(level, category, message, **context)` → `event_log` table
- 📋 `pipeline.py` — Stage 2; add phase `08_supabase_sync` to `PHASE_ORDER`, read `source_config`, emit `run_start`/`run_finish` events, accept `--no-supabase`
- 📋 `util/http.py` — Stage 2; emit `scrape_4xx` / `scrape_http` events
- 📋 `db/nonprofit_bmf.py` — Stage 4
- 📋 `scripts/stage7_lock_matrix.py` — Stage 7
- 📋 `scripts/postrun_check.py` — Stage 8
- 📋 entire `whrb-web/` app source (Next.js 15) — Stage 5 onward (only `whrb-web/supabase/` exists today)
- 📋 `.github/workflows/run-pipeline.yml` — Stage 10

**Plan round-6 clarifications (Stage 2 entry decisions)** — see `/Users/countcowy/.claude/plans/soft-crafting-tulip.md` round-6 addendum and `ROLLOUT.md` "Pre-Stage-2 prep" section for the full list. Key points:
- No Stage 1 regression rerun, no intermediate pipeline dry run.
- `source_config` seeded during Stage 2 (one row per scraper, `enabled=true`, idempotent).
- Network-kill integrity test is simulated (monkey-patch one `upsert` to raise `ConnectionError`), not a manual wifi toggle. Deviation will be documented in `ROLLOUT.md` Stage 2 entry.
- Stage 2 target is `WHRB dev` (`kolfijjavwruwzctmnlx`) directly.

**Plan round-7 clarifications (Stage 2 implementation decisions, 2026-04-18)** — see plan round-7 addendum for full text. Key points:
- Every pipeline run (CLI + web) inserts a `pipeline_runs` row and stamps every `event_log` row with the resulting `pipeline_run_id`. CLI runs set `triggered_by=null`; `args` captures the argv string (e.g. `"--fresh --with-hic"`).
- `--no-supabase` CLI flag added (skips only phase `08_supabase_sync`); composes with existing `--dry`.
- Per-batch retry lives inside `db/supabase_sync.py` (tenacity, max 3 attempts, reuses `util/http.py::RETRYABLE_EXCEPTIONS`). A failed batch logs `category='supabase_upsert' level='error'` and sync continues with the next batch.
- `priority_score` is authoritative-from-pipeline (always refreshed on upsert) but respects `user_overrides["priority_score"]` if set.
- `util/http.py` logs: `scrape_4xx` at `level='warn'`, `scrape_http` (retry exhaustion) at `level='error'`. Log emission is fire-and-forget and must never raise.
- Centralized integrity script: `scripts/stage2_integrity.py` with `--simulate-network-kill` flag; exits non-zero on failure.
- Stage 2 branch: `stage2/pipeline-sync` off `main`. Commit + push only when all integrity tests green; reuses existing remote.
- `--fresh` intentionally leaves `cache/http_cache.sqlite` alone (phase/source checkpoints cleared, HTTP cache preserved).
- Pipeline hand-off: Claude launches `python pipeline.py --fresh --with-hic` via Bash `run_in_background=true`.

All prior Phase 1–3 changes + Phase 4 Stage 1 are committed (cc4e7f4). The `pipeline_notes` rename is uncommitted at the time of this note — will be folded into the Stage 2 commit.
