# Pre-Stage-10b prep (2026-04-21)

Captured after Stage 10 exit (PR #15 merged, 12/12 integrity
PASS, cron reverted to `0 8 1,15 * *`) and during a Stage 10
review round so decisions are durable across sessions. These
supersede plan §9 where they conflict; formalised as a
round-11 clarifications addendum in the parent plan (§22).

**Stage 10b NOT yet kicked off.** User explicitly confirmed
this is pre-prep only; §3.1 / §2.7 explicit-go-ahead gate
remains open. No branch cut, no code changes.

### Process rule (durable)

- Exit the current worktree (`frosty-gauss-f1363b`, used for
  this review) before cutting `stage10b/polish`. Branch forks
  off `origin/main` at the Stage 10 exit commit `41ce261`
  (PR #15 merge) in the **top-level `Listing/` checkout**.
  Matches the Stage 10 pattern (round-10 §21.1 item 2).
- No mid-stage merge expected for Stage 10b — unlike Stage 10,
  nothing in 10b's scope requires code on `main` before Tk
  runs. Revert to §3.1 "commit + push only when all Tk green".

### Mobile hardware (closes plan §2 "still to confirm")

- **iOS device available** for T20 real-device smoke
  (confirmed 2026-04-21).
- **BrowserStack not available.** Pre-kickoff research task:
  check LambdaTest free tier, Sauce Labs Open-Source, or
  BrowserStack's open-source programme for eligibility.
- **Fallback path** if no free alternative surfaces by
  kickoff: Android coverage is Chrome DevTools Pixel-emulated
  only; T20 documents this as a scope reduction with user
  sign-off. iOS real-device smoke remains mandatory.

### Email path

- Resend remains deferred to Stage 11 (plan §2.6, unchanged).
  T06 asserts the `email_skipped_no_provider` log event; no
  actual send.

### Lighthouse Accessibility gate — relaxed

- **Threshold lowered from ≥ 95 to ≥ 90** on T21 (user
  preference, 2026-04-21). Applies to Home, All Prospects,
  Detail, My Clients kanban across both themes. Still a hard
  exit gate at the new threshold.

### Bulk-fixture precheck against dev Supabase (2026-04-21)

Ran a live read against `kolfijjavwruwzctmnlx.supabase.co` to
size the T10 bulk-assign dataset:

```
prospects where tier='C' AND category ILIKE 'landscap%'  → 2 rows
  ids: e92f3505-3593-4caf-84a1-b6456cf63c9a   category='landscaping'
       92bad05d-85ba-452e-9fe9-558b1cc99c10   category='landscaping'

prospects where category ILIKE 'landscap%' (any tier)    → 4 rows
  by tier: { B: 2, C: 2 }

prospects where tier='C' (total)                         → 297 rows
```

**Decision.** `stage10b_plant.py` MUST seed ~28 synthetic
Tier-C + `category='landscaping'` rows so the T10 sample
reaches ~30. Plan §9.7's "if the existing dataset doesn't
have enough" clause is resolved as "yes, seed". Synthetic
rows carry a recognisable tag (name prefix + internal note)
so `stage10b_cleanup.py` deletes exactly the planted set and
leaves the 2 real rows untouched. The 2 real Tier-C
landscaping rows are included in the T10 bulk-assign target
alongside the 28 synthetic rows — matches the T10 assertion
"N rows reassigned; count = SQL count".

### State at prep close (what a Stage 10b kickoff inherits)

- `main` at `41ce261` (PR #15 merge, Stage 10 exit).
- CI green on main (whrb-prospects CI 47s, whrb-web CI green
  on PR #15).
- No open PRs.
- Dev Supabase project `kolfijjavwruwzctmnlx`:
  - 3 pipeline_runs audit-trail rows kept from Stage 10
    (smoke `445a67ba`, T01-UI `3eae34de`, scheduled
    `a263ef9e`, force-fail `2fbe6271`).
  - Database trigger `pipeline_run_dispatch` + Edge Function
    `github-dispatch` live.
  - Workflow `run-pipeline.yml` on production cron cadence
    (`0 8 1,15 * *`).
- Schema prereqs for Stage 10b already in place from Stage 1's
  `000_init.sql`:
  - `user_preferences` (L149, RLS self-policy L357–361).
  - `notifications` (L161, RLS + indexes L162–176).
  - `prospect_presence` (L178, RLS + `last_seen_at` index
    L185).
- Stage 10b placeholder not yet replaced:
  `whrb-web/app/(app)/settings/notifications/page.tsx` still
  renders `<PagePlaceholder stage="Stage 10b" ... />`.

### Stage 10b kickoff

Explicit "start Stage 10b" received 2026-04-22.

**Round-12 additions (in-session, 2026-04-22):**

- **All 6 user_preferences toggles wired end-to-end.** Round-11 assumed
  assignment-only; user upgraded scope: `note_mention` (email-prefix
  matching), `run_complete` (admin recipients), `feedback_status` (extend
  Stage 9 admin route) all insert `notifications` rows + gated email stub.
- **XLSX library = `exceljs`** (not `xlsx` / SheetJS community — CVE flag).
- **Nav mobile = hamburger drawer.** NotificationBell click navigates
  directly to `/notifications` (no dropdown).
- **Rate limiter = Upstash Redis.** Free-tier DB provisioned on
  `calm-stag-75326.upstash.io`. `UPSTASH_REDIS_REST_URL` +
  `UPSTASH_REDIS_REST_TOKEN` set in `whrb-web/.env.local` + Vercel
  Production/Preview/Development. **Rotation candidate** — value was
  exposed in a chat transcript (same pattern Stage 10 noted for
  `GH_DISPATCH_PAT`).
- **Assign notif pairs.** Reassignment from A→B inserts TWO rows:
  `kind='unassigned'` for A + `kind='assigned'` for B.
- **Bulk delete confirm.** Both client (disabled submit until `DELETE`
  typed) AND server (payload must include `{ confirm: 'DELETE' }`).
- **`@mention` parse.** Match `@<email-prefix>` against `profiles.email`
  exactly (case-insensitive); skip self.
- **Migration application path.** `apply_stage10b_migration.py` uses the
  `aws-1-us-west-2.pooler.supabase.com` host (direct IPv6 unreachable from
  this network). The project's actual region is **us-west-2** (Oregon);
  the legacy `aws-0-us-east-1` pooler string in older apply scripts was a
  never-exercised fallback that only mattered when direct IPv6 stopped
  working. **Stage 11 readiness memo recommends the prod project be in
  us-east-1 or us-east-2** (closer to Cambridge users; current ~70–80 ms
  RTT overhead per query).

### Stage 10b kickoff

Explicit "start Stage 10b" authorization received 2026-04-22. Branch
created: `stage10b/polish` at `41ce261`.


---

