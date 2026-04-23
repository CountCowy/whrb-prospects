# WHRB Prospects

Boston-area ad sales prospect builder for WHRB 95.3 FM, Harvard Radio
Broadcasting — with a Next.js console for the sales team to work the
list.

*Developed by Yareh Constant.*

---

## Why this exists

WHRB 95.3 FM is a Harvard non-commercial educational (NCE) station. By
FCC rule, "ads" are **underwriting announcements** — brand association,
no calls to action, no price mentions, no direct-response metrics. That
constraint shapes who the right prospect is: brands that want to be
seen next to BSO, MFA, and Harvard, not anyone who needs measurable
conversions in 30 days.

The current rate card (per the 2026 media kit):

| Daypart | 30s spot | 60s spot |
|---|---|---|
| Classical (peak) | $60 | $75 |
| Jazz / Blues / Hillbilly | $45 | $60 |
| Record Hospital / The Darker Side | $30 | $45 |

Typical packages run **$100 – $3,000**. That price floor reaches down
to small businesses, not just institutions, which is why the pipeline
deliberately surfaces three tiers:

- **Tier A** — anchor sponsors (cultural institutions, premium retail,
  senior living, wealth management).
- **Tier B** — mid-market local (independent restaurants, boutique
  retail, professional services).
- **Tier C** — micro-local home services (landscapers, painters,
  plumbers — highly seasonal, ~6–8 week pre-peak outreach windows).

---

## Repo layout

```
.
├── whrb-prospects/   Python pipeline: scrape → enrich → dedupe → score → sync
├── whrb-web/         Next.js 15 sales console (magic-link auth, Supabase)
├── docs/             Architecture, data model, runbook, glossary
├── bin/              Repo-wide tooling (terminology audit, vocab diff)
├── ROLLOUT.md        Per-stage progress log against dev Supabase
├── ROLLBACK.md       Migration rollback procedure
├── TAGS.md           Canonical tag vocabulary
├── TERMINOLOGY.md    Buyer-noun rules + allowlist
└── .github/          CI workflows + pipeline dispatch
```

It is one git repo with two packages (a "monorepo"). The two halves
share a single Supabase project — both write into the same
`event_log`, both read the same `prospects`.

---

## How the halves fit together

```
public data sources → whrb-prospects pipeline → Supabase → whrb-web console → sales rep
                                                ↑
                                                │
                                          shared event_log
                                          (pipeline + web both write here)
```

The pipeline runs on a schedule (twice-monthly cron + on-demand admin
trigger from `/admin/runs`). The web app is always-on. Both observe
themselves into the same `event_log` table; admins triage from
`/admin/logs`.

---

## Getting started

No setup commands here — both halves have detailed READMEs.

| I want to… | Open |
|---|---|
| Run the pipeline locally | [whrb-prospects/README.md](whrb-prospects/README.md) |
| Run the web app locally | [whrb-web/README.md](whrb-web/README.md) |
| Read the schema | [docs/DATA-MODEL.md](docs/DATA-MODEL.md) |
| Understand the architecture | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Run / debug operations | [docs/RUNBOOK.md](docs/RUNBOOK.md) |
| See what's shipped so far | [ROLLOUT.md](ROLLOUT.md) |

You'll need Python 3.11+, Node 20 (matches `whrb-web/.nvmrc`), pnpm
10, and a Supabase project. No paid services anywhere on the stack.

---

## Tech stack at a glance

**Pipeline (whrb-prospects):**
Python 3, `requests-cache` (sqlite, 24h TTL), `httpx` (async contact
scrape), `playwright` (JS sites), `rapidfuzz` (dedupe), `pdfplumber`
(program books), `supabase-py` + `psycopg2`. Free-only API constraint:
OSM Overpass instead of Google Places, Apollo / Hunter free tiers,
`email-validator` + `dnspython` instead of NeverBounce.

**Web (whrb-web):**
Next.js 15.5 App Router, React 19, TypeScript strict, Tailwind v4,
`@supabase/ssr` (cookie auth + PKCE), `next-themes` (system / light /
dark), `sonner` (toasts), `@tanstack/react-table`, `@dnd-kit/*`
(kanban), Playwright (e2e). Deployed on Vercel.

---

## Status + attribution

Development is staged and tracked in [`ROLLOUT.md`](ROLLOUT.md). See
that file for what's currently shipped.

> © Harvard Radio Broadcasting Co., Inc. All rights reserved —
> internal WHRB project. Developed by Yareh Constant.
