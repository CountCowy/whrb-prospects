# Pre-Stage-5 prep (2026-04-19, post-Stage-4)

Captured per plan round-9 clarifications addendum. Logged here so the Stage 5 entry state is explicit. Nothing below has been executed yet — it records the agreed-upon entry plan.

### Branch + PR

- **Stage 4 PR** opened at [whrb-prospects#3](https://github.com/CountCowy/whrb-prospects/pull/3) (stages 2–4 → `main`).
- **Stage 5 branch:** `stage5/web-skeleton` forks from `stage4/nonprofit-enrichment` (continues the stage-to-stage fork pattern).

### Vercel (dev project)

- Existing Vercel project `whrb-prospects-dev` at `https://whrb-prospects.vercel.app/` (URL unchanged after rename). Dev-only; Stage 11 creates a second project for prod.
- Root Directory: `whrb-web/`. Framework Preset: Next.js. Node: 20.x. Production Branch: `main`. Preview Deployment Protection: **disabled**.
- Env vars set (Production + Preview + Development): `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Service role key never prefixed `NEXT_PUBLIC_`.
- Supabase Auth redirect URLs include `https://whrb-prospects-*.vercel.app/**` and `https://whrb-prospects-*.vercel.app/auth/callback`.

### Stack decisions

- **pnpm** (standalone project; no repo-root workspace).
- **Node 20** pinned via `whrb-web/.nvmrc`.
- **Tailwind v4**, **shadcn/ui** (`new-york` style, base color `neutral`, CSS variables).
- **Crimson** (`#A51C30` light, `~#C63244` dark) exposed as the Tailwind `primary` token.
- **TypeScript strict** ON. **ESLint** (`eslint-config-next` + `@typescript-eslint` strict) + **Prettier** (2-space, single quotes, trailing commas `all`, semicolons, 100 cols) + `prettier-plugin-tailwindcss`. **Husky + lint-staged** pre-commit.
- **Toast:** `sonner`. **Theme default:** `system`.
- **Logo:** downloaded from `https://www.whrb.org/_astro/whrb_logo.B7VcAkTb.svg` → `whrb-web/public/whrb-logo.svg` (committed). Top-left nav, ~32px, links to `/`. Favicon: placeholder.
- **Page `<title>`:** "WHRB Sales".
- **Auth callback:** `whrb-web/app/auth/callback/route.ts`.
- **Protected routes:** `middleware.ts` + `@supabase/ssr` session check → `/login`. `/admin/**` additionally checks `profiles.role='admin'` server-side → 403.

### Integrity + tooling

- **Stage 5 integrity — mixed.** DB checks in Python (`whrb-prospects/scripts/stage5_integrity.py`); browser/DOM/theming/bundle-grep checks manual, documented here with screenshots.
- **Vercel CLI** installed (global) for deploy inspection.
- **GitHub Actions** at Stage 5: `.github/workflows/whrb-web-ci.yml` runs `pnpm install`, `pnpm typecheck`, `pnpm lint` on PRs touching `whrb-web/**` (paths-scoped).
- **`whrb-web/README.md`** authored at the end of Stage 5.

### DB pre-state trusted

From Stage 4 exit record: 2,935 `public.prospects` rows (2,933 pipeline + MFA + Boston Ballet seeded), BSO override restored, `event_log` clean of `level='error'` rows across stages 2–4. No empirical re-verification before Stage 5 begins; Stage 5's logging tests will surface any drift.

---

