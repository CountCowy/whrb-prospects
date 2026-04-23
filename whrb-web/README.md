# whrb-web

*Developed by Yareh Constant.*

Next.js 15 app for the WHRB 95.3 FM sales team — magic-link auth, Crimson-accented theming, unified event logging against the existing Supabase `WHRB dev` project.

This is one half of the WHRB Prospects monorepo (the sales console);
the Python pipeline that fills it lives in
[`../whrb-prospects/`](../whrb-prospects/). For the full system map see
[`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md). Per-stage progress
log lives in [`../ROLLOUT.md`](../ROLLOUT.md).

## Stack

- Next.js 15.5 App Router + React 19 + TypeScript (strict)
- Tailwind v4 (`@custom-variant dark` + `@theme inline`)
- `@supabase/ssr` 0.5.x + `@supabase/supabase-js` 2.x — cookie-based session, PKCE
- `next-themes` — System / Light / Dark, `attribute="class"`, default `system`
- `sonner` — toasts
- `next/font/google` Inter — `--font-sans` variable
- ESLint (next + @typescript-eslint strict) + Prettier + `prettier-plugin-tailwindcss`
- pnpm 10, Node 20 (`.nvmrc`)

## Quickstart

```bash
nvm use            # reads .nvmrc → Node 20
pnpm install --frozen-lockfile
cp .env.local.example .env.local   # fill in WHRB dev creds
pnpm dev           # http://localhost:3000
```

### Environment variables

Exact parity with the Vercel project (Production + Preview + Development):

| Var                             | Exposed to client | Source                                           |
| ------------------------------- | ----------------- | ------------------------------------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`      | yes               | `WHRB dev` project URL                           |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes               | `WHRB dev` anon key                              |
| `SUPABASE_URL`                  | no                | server-only mirror (used by `lib/env.server.ts`) |
| `SUPABASE_ANON_KEY`             | no                | server-only mirror                               |
| `SUPABASE_SERVICE_ROLE_KEY`     | no                | **server-only**, never `NEXT_PUBLIC_`            |

The service role key is guarded by `lib/env.server.ts` (imports `server-only`);
any accidental client import fails the build. Integrity test **T02** scans
`_next/static/*.js` for leaks.

## Scripts

```bash
pnpm dev           # next dev
pnpm build         # next build
pnpm start         # next start
pnpm typecheck     # tsc --noEmit
pnpm lint          # eslint . --max-warnings 0
pnpm format        # prettier --write .
pnpm format:check  # prettier --check .
pnpm e2e           # Playwright e2e (auto-starts pnpm dev on localhost)
pnpm e2e:ui        # Playwright inspector — interactive run / debug
pnpm e2e:debug     # Playwright headed run with the debugger attached
```

## Auth flow

1. `/login` → email form → `supabase.auth.signInWithOtp({ shouldCreateUser: false })`.
2. User clicks magic link in email.
3. Supabase redirects to `/auth/callback?code=<pkce>` (production) or
   `/login#access_token=...&refresh_token=...` (admin-generated links).
4. The `?code=` path is redeemed in `app/auth/callback/route.ts` via
   `exchangeCodeForSession`. The hash path is redeemed client-side in
   `LoginForm.tsx` via `supabase.auth.setSession`, then `router.replace(next)`.
5. `middleware.ts` enforces auth on every route except `/login` and
   `/auth/callback`, and redirects unauthenticated requests to `/login?next=<path>`.

`/admin/**` additionally requires `profiles.role='admin'` (server-side check,
arriving in Stage 9 — currently an admin-only route group still guarded by the
auth redirect).

## Theming

- `app/globals.css` defines semantic tokens (`--background`, `--foreground`,
  `--surface`, `--surface-2`, `--border`, `--border-subtle`, `--primary`,
  `--primary-soft`, `--muted-foreground`, …). Dark theme bumps `--primary`
  from `350 71% 38%` (`#A51C30`) to `350 62% 56%` (`#C63244`) to hold ≥4.5:1
  contrast on dark surfaces.
- `ThemeToggle` (top-right of every authenticated page) is an icon-only
  pill with System / Light / Dark. Active option is tinted crimson on a
  raised surface.
- **Crimson is an accent only** — used for borders, gradient hairlines on
  stat cards, the `.accent-gradient` hero, pill badges, and the active nav
  tab (as `bg-primary-soft text-primary`, never solid crimson over text).

## Event logging

Three streams, one `event_log` table:

| Surface                                  | Writer                                                      |
| ---------------------------------------- | ----------------------------------------------------------- |
| Pipeline (Python)                        | `whrb-prospects/util/event_log.py` (batched)                |
| Next.js server (middleware + API routes) | `lib/logging/server.ts` → service-role insert               |
| Browser                                  | `lib/logging/client.ts` → `POST /api/log` (anon, RLS-gated) |

The browser logger hooks `window.onerror` and `unhandledrejection` at mount,
plus a React `ErrorBoundary` for render exceptions. Validated categories:
`route_404`, `api_exception`, `ui_exception`, `unhandled_rejection`.

## Deployment

Vercel project: **`whrb-prospects-dev`** at scope `countcowys-projects`.
Root directory: `whrb-web/`. Framework preset: Next.js. Node: 20.

```bash
# from the monorepo root (where .vercel/ lives)
vercel deploy --yes                         # preview
vercel deploy --yes --prod                  # production
vercel deploy --yes --env NEXT_PUBLIC_…     # override single env var
```

Preview deployments get a URL like
`https://whrb-prospects-<hash>-countcowys-projects.vercel.app`. The stable
production alias is `https://whrb-prospects.vercel.app/`. CI gate on
`whrb-web/**` changes: `.github/workflows/whrb-web-ci.yml`.

## Integrity

`whrb-prospects/scripts/stage5_integrity.py --deploy-url <preview-url>`
covers the automated matrix (7/7):

1. **T01** `.env` populated with Supabase URL + anon + service role keys
2. **T02** no service-role prefix in any `_next/static/*.js` (matches unique
   signature segment of the service JWT, not the shared header)
3. **T03** every protected route redirects to `/login` for anon users
4. **T04** `/login` renders 200 without a session
5. **T05** `/auth/callback` without `?code=` redirects to `/login?error=…`
6. **T06** all 10 Stage-1 tables reachable via service role (shape check)
7. **T07** `POST /api/log` rejects invalid bodies with 400

Plus the browser-driven T08 follow-up (`--post-browser --since-iso <ISO>`),
which confirms the four event_log categories above landed.

## Running e2e tests

Playwright lives in `e2e/` (Stage 6a bootstrap). One `setup` project mints a
synthetic user via `supabase.auth.admin.generateLink` + `verifyOtp`, drops the
session into the app via the existing `LoginForm` hash-token fallback, waits
for `@supabase/ssr` to flush the auth cookie, then persists `storageState` to
`e2e/.auth/user.json`. All other projects depend on `setup` and start
authenticated.

```bash
# Local run — auto-starts `pnpm dev` and drives it
pnpm e2e

# Against a deployed preview URL (skips the auto-`pnpm dev`)
E2E_BASE_URL="https://whrb-prospects-<hash>-countcowys-projects.vercel.app" pnpm e2e

# Interactive inspector
pnpm e2e:ui
```

Required env (either via `.env.local` or exported):

| Var                                                   | Used by                                        |
| ----------------------------------------------------- | ---------------------------------------------- |
| `SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL`           | auth.setup admin + anon clients                |
| `SUPABASE_ANON_KEY` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | auth.setup `verifyOtp`                         |
| `SUPABASE_SERVICE_ROLE_KEY`                           | auth.setup `admin.createUser` / `generateLink` |
| `E2E_BASE_URL` _(optional)_                           | overrides baseURL for remote targets           |
| `E2E_USER_EMAIL` _(optional)_                         | defaults to `stage6a-smoke@example.com`        |

Outputs (gitignored): `playwright-report/` (HTML report), `test-results/`
(traces + screenshots + videos on failure), `e2e/.auth/user.json` (session
cookies).

### CI

`.github/workflows/whrb-web-ci.yml`'s `e2e` job runs on every PR that touches
`whrb-web/**`. It waits for the Vercel preview deployment on the PR head
commit (`patrickedqvist/wait-for-vercel-preview`) and runs Playwright against
that URL. Requires these repository secrets: `SUPABASE_URL`,
`SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. The HTML report is uploaded
as a workflow artifact for 14 days; traces are uploaded on failure only.

## Layout

```
whrb-web/
├── app/
│   ├── (auth)/login/            # LoginForm + hash-token fallback
│   ├── (app)/                   # everything behind middleware auth
│   │   ├── page.tsx             # HOME — hero, stat cards, recent activity
│   │   ├── prospects/           # All Prospects (placeholder → Stage 6)
│   │   ├── my/                  # My Clients (placeholder → Stage 7)
│   │   ├── team/                # Team (placeholder → Stage 6)
│   │   ├── settings/            # Settings (placeholder → Stage 10b)
│   │   └── admin/               # Admin console (placeholder → Stage 9)
│   ├── api/
│   │   ├── log/route.ts         # client-log ingress
│   │   └── dev/throw/route.ts   # integrity harness — throws on GET
│   └── auth/callback/route.ts   # PKCE exchange
├── components/
│   ├── Nav.tsx                  # sticky glass nav
│   ├── ThemeToggle.tsx          # icon pill
│   ├── PagePlaceholder.tsx      # shell for stages 6-10b
│   └── ErrorBoundary.tsx
├── lib/
│   ├── env.ts                   # client-safe envs
│   ├── env.server.ts            # service-role (server-only import)
│   ├── supabase/{client,server,service,middleware}.ts
│   └── logging/{client,server}.ts
├── middleware.ts                # auth redirect + 404 log
├── supabase/migrations/000_init.sql
└── vercel.json                  # framework lock
```

## Known quirks

- **Edge runtime aliases.** `middleware.ts` imports via relative paths
  (not `@/`), because the Edge bundler resolves hoisted package dirs
  differently and breaks on the `@/` alias indirection.
- **Hash-token magic links.** Admin-generated links from Supabase's
  `generate_link` API return `#access_token=…&refresh_token=…` in the
  URL hash. LoginForm detects this, calls `setSession`, then
  `router.replace`. The `?code=` path (real email links) is handled
  server-side by `/auth/callback`.
- **Preview URL cookies don't carry over.** Each preview deployment has
  its own origin; signing in on one preview won't carry to the next.
  Use the admin-generate-link flow or a fresh magic-link.

## Next stages

- Stage 6 — read-only views + shared data grid + feedback widget + Team page
- Stage 7 — editing + assignment + notes + kanban + edit-lock UI
- Stage 8 — `postrun_check.py` end-to-end contract test
- Stage 9 — admin console (sources, runs, users, logs, feedback)
- Stage 10 — `POST /api/pipeline/run` + GitHub Actions worker
- Stage 10b — presence, notifications, bulk actions, exports, mobile
- Stage 11 — production cutover (Resend, custom domain, second Supabase project)
