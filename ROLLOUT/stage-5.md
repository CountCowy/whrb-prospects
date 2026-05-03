# Stage 5 — Next.js skeleton + auth + theming + logging (2026-04-19)

- **Started:** 2026-04-18 ~19:00 America/New_York (scaffold work)
- **Exited:** 2026-04-19 13:30 America/New_York (after redesign + re-verification)
- **Branch:** `stage5/web-skeleton` (off `stage4/nonprofit-enrichment`)
- **Tester:** claude (agent session) + Count / `kingyareh@gmail.com`
- **Preview URL (final):** `https://whrb-prospects-mf4x309td-countcowys-projects.vercel.app/`

### Artifacts landed

- **`whrb-web/`** — Next.js 15 app skeleton (per plan Stage 5 scope).
  - `app/(auth)/login/{page,LoginForm}.tsx` — magic-link form with hash-token fallback for admin-generated links.
  - `app/(app)/layout.tsx` + `Nav.tsx` + all shell pages (`/`, `/prospects`, `/my`, `/team`, `/settings/notifications`, `/admin/{sources,runs,users,logs,feedback,prospects/bulk}`).
  - `app/auth/callback/route.ts` — PKCE exchange.
  - `app/api/log/route.ts` — client-log ingress (400 on bad body).
  - `app/api/dev/throw/route.ts` — integrity harness.
  - `components/{Nav,ThemeToggle,PagePlaceholder,ErrorBoundary}.tsx`.
  - `lib/env.ts` + `lib/env.server.ts` (server-only service-role guard), `lib/supabase/{client,server,service,middleware}.ts`, `lib/logging/{client,server}.ts`.
  - `middleware.ts` — auth redirect + 404 logging.
  - `app/globals.css` — Tailwind v4 tokens, Crimson primary, dark variant, `.accent-gradient`, shadow system, `--font-sans` hookup.
  - `vercel.json` (framework lock), `.nvmrc`, `.prettierrc.json`, `eslint.config.mjs`, `postcss.config.mjs`, `next.config.ts`, `tsconfig.json`, `package.json`, `pnpm-lock.yaml`, `public/whrb-logo.svg`.
- `whrb-prospects/scripts/stage5_integrity.py` — 7 automated DB/HTTP checks plus a `--post-browser --since-iso` mode for the T08 event_log assertion.
- `.github/workflows/whrb-web-ci.yml` — pnpm typecheck + lint on PRs touching `whrb-web/**`.
- `whrb-web/README.md` — quickstart, env, deploy flow, known quirks.
- Screenshots: `whrb-prospects/docs/screenshots/stage5/{login-v2,home-dark-v2,home-light-v2,prospects-placeholder-v2}.png`.

### Vercel integration

- Linked the monorepo root to Vercel project `whrb-prospects-dev` (scope `countcowys-projects`). `.vercel/` lives at the monorepo root (not inside `whrb-web/`) so `rootDirectory: whrb-web/` resolves without double-nesting.
- `whrb-web/vercel.json` pins `framework: "nextjs"` — the Vercel project's stored preset was `null`, which made the initial preview deploy return 500 MIDDLEWARE_INVOCATION_FAILED + 404 on API routes. The in-repo vercel.json overrides that.
- Env var parity verified across Production + Preview + Development: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.

### Integrity results — 7/7 automated + T08 post-browser

Automated (`stage5_integrity.py --deploy-url <preview>`):

```
[PASS] T01 .env populated (SUPABASE_URL + ANON_KEY + SERVICE_ROLE_KEY)
[PASS] T02 no SERVICE_ROLE or service-key prefix in any /_next/static/*.js  scanned=12
[PASS] T03 unauthenticated GETs on all 11 protected routes redirect to /login
[PASS] T04 /login renders 200 without a session                              status=200
[PASS] T05 /auth/callback without code redirects to /login (no crash)        status=307
[PASS] T06 all 10 Stage-1 tables reachable via service role                  found=10/10
[PASS] T07 /api/log rejects invalid bodies with 400                          bad_body=400 invalid_payload=400
```

T08 post-browser (driven via chrome-devtools MCP; admin-generate-link + `supabase.auth.setSession` to authenticate automatically): all four event_log categories confirmed present across the harness window — `api_exception`, `route_404`, `ui_exception`, `unhandled_rejection`, `window_total=6`.

### Manual checks (locked in with screenshots)

- **Theme toggle:** System / Light / Dark swaps background, surface, text, borders, stat-card hairlines, nav chrome without reload. No flash-of-light on Dark reload. Icon-only pill; active option tinted crimson on raised surface.
- **Crimson accent:** `hsl(var(--primary))` renders `#A51C30` in Light and `#C63244` in Dark (matches tokens `350 71% 38%` / `350 62% 56%`). Used as accent only: pill badges, `.accent-gradient` hero backdrop, stat-card top hairline, hero name accent, active nav tab tint, link focus ring, "Send magic link" CTA.
- **Nav readability:** active tab uses `bg-[hsl(var(--primary-soft))] text-[hsl(var(--primary))]` — a soft crimson tint, never a solid crimson fill. Resolves the earlier crimson-on-crimson visibility issue.
- **Lighthouse (desktop):** Performance 98, Accessibility 98, Best Practices 96, SEO 63. **Mobile:** 80 / 96 / 96 / 63. SEO is low because the app is `noindex` by design (internal tool); accepted.
- **Magic-link round-trip:** real email-link signed in via the PKCE `/auth/callback` flow. Admin-generated links sign in via the hash fallback. Both verified.

### Visual redesign (post-integrity pass)

After the initial 7/7 + T08 green, the user requested a more modern look. Changes landed on the same branch before commit:

- Inter font wired via `next/font/google` → `--font-sans` Tailwind token.
- Added `--surface` / `--surface-2` / `--border-subtle` / `--primary-soft` / `--primary-soft-border` / shadow tokens.
- Sticky, glass-blurred `Nav` with logo + "Sales" eyebrow, settings icon-button, ghost Sign-out.
- Icon-only `ThemeToggle` (monitor / sun / moon) inside a pill.
- Redesigned Home: `.accent-gradient` hero, pill badge "WHRB 95.3 FM · Sales", crimson-accented first-name greeting, stat cards with top-hairline gradient + hover shadow lift + `tabular-nums`, recent-activity skeleton bars.
- Redesigned Login card: centered `rounded-2xl` on `accent-gradient` backdrop, top crimson hairline, logo + "SALES" eyebrow, refined input with focus ring glow, footer wordmark.
- New `PagePlaceholder` component applied to every Stage-6-through-10b shell page (`/prospects`, `/my`, `/team`, `/settings/notifications`, and six `/admin/*` pages). Consistent eyebrow + h1 + stage pill + surface card.
- Typecheck + lint + build re-verified green after redesign. Preview re-deployed; `stage5_integrity.py` re-run against the new URL — 7/7 still pass.

### Plan deviations

- **Framework preset override via `vercel.json`.** Plan assumed the Vercel dashboard preset would be authoritative. It was null for this project. Fixed by committing `whrb-web/vercel.json` with `framework: "nextjs"`. Future redeploys are framework-correct regardless of dashboard drift.
- **T02 service-role leak check tightened.** Naive `SERVICE_KEY[:40] in bundle` false-positive-matched the shared JWT header prefix (`eyJhbGciOi…`) that anon and service tokens have in common. Switched to matching the service key's signature segment (`SERVICE_KEY.rsplit(".", 1)[-1]`), which is unique. Also split envs: `lib/env.ts` is client-safe (URL + anon only); service role moved to `lib/env.server.ts` with `'server-only'` guard.
- **`app/api/_dev/throw` → `app/api/dev/throw`.** Next's private-folder convention (leading underscore) excludes the route from the build, so the harness returned 404 instead of the intended 500. Renamed.
- **Browser error logging.** Initial `installGlobalErrorHandlers` only hooked `unhandledrejection`. Added `window.addEventListener('error', …)` to catch uncaught sync errors (including `throw` from the DevTools console).
- **Edge middleware aliases.** Edge bundler does not resolve the `@/lib/*` alias through hoisted package dirs. Middleware imports were switched to relative paths (`./lib/…`, `../env`).
- **Hash-token magic-link fallback.** `LoginForm` adds a `useEffect` that parses `#access_token=…&refresh_token=…` and calls `supabase.auth.setSession`, then `router.replace(next)`. Needed because Supabase's admin `generate_link` returns implicit tokens, not PKCE codes. Real email links still flow through `/auth/callback`.

### Exit-gate criteria (all green)

- [x] 7/7 automated integrity tests pass on latest preview
- [x] T08 post-browser confirms all four event_log categories land
- [x] Magic-link round-trip works end-to-end (PKCE + hash-token)
- [x] Theme toggle switches all three modes without reload / FOUC
- [x] Crimson accent verified at `#A51C30` / `#C63244`
- [x] Active-nav text readable (crimson-soft tint, not solid crimson)
- [x] `pnpm typecheck && pnpm lint && pnpm build` green locally
- [x] Visual redesign approved; preview re-verified
- [x] `whrb-web/README.md` written
- [x] `.github/workflows/whrb-web-ci.yml` runs on PRs touching `whrb-web/**`

**Stage 5 exit gate: GREEN. Stage 6 (read-only views + data grid) may proceed.**

