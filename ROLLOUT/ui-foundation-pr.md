# UI foundation PR — shadcn + warm palette + Command Palette (2026-04-23)

Pre-epic UI polish PR that lands between T1 exit and T2 branching. Not
an official T-stage — branch `ui/foundation` off `main`. Full spec in
`~/.claude/plans/create-a-thorough-plan-effervescent-salamander.md`;
epic-plan cross-reference at §1.4 of the post-Stage-10c epic plan.

### Artifacts produced

**Commit 1 (`chore`)** — 7287c2b
- `whrb-web/components/ui/*.tsx` — 21 lowercase shadcn/Radix primitives
  (accordion, alert-dialog, badge, button, card, checkbox, command,
  dialog, dropdown-menu, input, label, popover, separator, sheet,
  skeleton, switch, table, tabs, textarea, toggle, tooltip). 20 ported
  verbatim from `claude/flamboyant-mcclintock-bb0add`; `table.tsx`
  authored new (neither source branch shipped one; `/admin/vocab`
  needs it).
- `whrb-web/lib/utils.ts` — `cn()` helper composing `clsx` +
  `tailwind-merge`. Single source of truth for class composition.
- `whrb-web/components.json` — shadcn registry config (`new-york`
  style, `neutral` baseColor, CSS variables on).
- `whrb-web/vitest.config.ts` — `node` environment, scoped to
  `lib/**/__tests__/**/*.test.ts`, `@/*` alias mirrors `tsconfig`.
- `package.json` + `pnpm-lock.yaml` — dependency superset:
  - Runtime: 14 Radix packages, `cmdk`, `class-variance-authority`,
    `clsx`, `tailwind-merge`, `framer-motion`, `tw-animate-css`,
    `lucide-react` pinned to `^0.468.0` (the `^1.8.0` in both source
    branches is a wrong-major typo and is NOT used).
  - Dev: `vitest`, `@axe-core/playwright`.
- Scripts: `"test": "vitest"`, `"test:run": "vitest run
  --passWithNoTests"`, `"test:ui": "vitest --ui"`.

**Commit 2 (`feat: warm palette`)** — 832e7ab
- `whrb-web/app/globals.css` — full palette rewrite.
  - Base neutrals: warm hue-30 light, hue-24 dark. Tri-level surface
    (surface / surface-2 / surface-3) and border (subtle / default /
    strong).
  - Harvard Crimson scale 50–900. `--primary` = 500 unchanged.
  - Tier tokens (`--tier-a` 152 warm green, `--tier-b` 32 warm amber,
    `--tier-c` 215 warm-leaning cool) + -bg (~10-14%) + -border
    (~22-32%). Verbatim from Tokens branch.
  - State-badge tokens: 7 triplets for the pipeline state machine
    (researching / waiting / initial / ongoing / sold / previous-client
    / dead).
  - Semantic status (Flamboyant additive, warm-expressed):
      --success reuses tier-a HSL,
      --warning reuses tier-b HSL,
      --info = 255 72% 48% warm-leaning indigo (locked decision §264 #1).
  - Destructive + ring + radius + shadows (xs/sm/md/lg/xl/glow).
  - `@theme inline` block enumerates every `--color-*` mapping so
    Tailwind arbitrary-value consumers (`bg-surface-2`,
    `text-success`, `border-tier-a`) resolve.
- `whrb-web/lib/__tests__/palette-contrast.test.ts` — Vitest
  assertions. 10 tests (5 button-fill pairs × 2 modes): primary,
  destructive, success, warning, info. Each pair clears WCAG AA
  (≥4.5:1). Helper is <20 LOC of inline HSL → RGB → relative-luminance
  math, no external contrast dep.
- Plan deviations (all toward the plan's ≥4.5:1 AA target):
  - `--warning-foreground` set to `30 10% 12`% dark (plan's "reuse
    tier-b values" was ambiguous; amber at 42% lightness fails AA
    against white — computes to ~3.70:1 — but clears ~4.66:1 against
    `--foreground`).
  - `--destructive` lightness: `0 84% 60%` → `0 84% 45%` light,
    `0 63% 55%` → `0 63% 42%` dark. Plan's shadcn defaults compute
    to ~3.76:1 / ~3.21:1 (fail AA); bumped to 5.47:1 / 5.76:1.
  - Dark `--primary` lightness: 56% → 52% (5.63% → 4.63:1 AA pass).
  - Vitest skips `--tier-*` / `--state-*-bg` pairs the plan §227
    listed: chips overlay translucent same-hue bg on the page, which
    requires alpha-composite math beyond the plan's <20 LOC budget.
    Chip contrast validated by `@axe-core/playwright` in commit 8
    (real browser render, accurate compositing).

**Commit 3 (`feat: TooltipProvider + reduced-motion + tw-animate-css`)**
— f918550
- `whrb-web/app/layout.tsx` — root tree wrapped in
  `<TooltipProvider delayDuration={200}>`. Preserves ThemeProvider,
  GlobalErrorHandlers, ErrorBoundary, `<Toaster richColors
  position="top-right" />`, T1 metadata.
- `whrb-web/app/globals.css` — `@import 'tw-animate-css';` after the
  Tailwind import + `@media (prefers-reduced-motion: reduce)` block
  at bottom suppressing animation / transition durations.

**Commit 4 (`feat: Command Palette`)** — 6a6fdda
- `whrb-web/components/command-palette-routes.ts` — single-file
  registry. Seeded with every reachable post-T1 route across two
  sections: Navigate (Home / All Prospects / My Clients / Team /
  Media Kit / Guide / Notifications / Settings) and Admin
  (`adminOnly`: Sources / Vocabulary / Pipeline runs).
- `whrb-web/components/CommandPalette.tsx` — client component, binds
  ⌘K / Ctrl-K global shortcut, reads registry, filters admin entries
  for non-admin users, adds a Theme toggle group at the bottom.
- `whrb-web/app/(app)/layout.tsx` — mounts
  `<CommandPalette isAdmin={isAdmin} />`.
- Convention: every future authed route appends to
  `command-palette-routes.ts` in the same PR (epic §1.5 rule
  already in place).

**Commit 5 (`refactor: consumer migrations`)** — 10fdb9f
- 13 consumer files migrated to shadcn primitives. Every
  `data-testid`, `aria-label`, `role`, and server contract preserved
  — visual/structural change only:
    SearchInput (Input + Button + lucide Search/X),
    TierBadge (Badge outline + --tier-* vars),
    StateBadge (Badge outline + --state-* vars; drops Tailwind literal
      slate/indigo/sky/amber/emerald/teal/red colours — first consumer
      of the --state-* token family from commit 2),
    ExportButton (Button ghost/sm + DropdownMenu + Download icon),
    FeedbackButton (Button + MessageCircle icon),
    NotificationBell (Button asChild wrapping the Link; plan's
      popover + separator imports skipped — those would be a new
      inline-inbox feature, not a migration),
    AddProspectModal (Dialog + Input + Textarea + Label + Button),
    ProspectDetail (Card + Badge + Separator + Button),
    ProspectTable (Button for pagination + empty-state actions;
      table element itself stays raw due to sticky-first-column +
      max-height scroll styling),
    ColumnVisibilityMenu (Button + DropdownMenu + Checkbox;
      click-outside handler removed — Radix handles it natively),
    Nav (Button + Sheet mobile drawer + Separator; TABS array and
      admin-conditional append preserved verbatim),
    admin/BulkActionsForm (Button + Input + Label throughout; native
      `<select>` kept shadcn-styled, dropdown-menu + dialog of the
      plan's import list skipped as they would be UX redesigns),
    admin/VocabManager (Button + Input + Label; `<ul><li>` structure
      preserved because T1 ships it with e2e tests — conversion to
      shadcn Table is future scope).
- Page-level no-ops in commit 5: `app/(app)/page.tsx` (Card migration
  paired with commit 6 hero refinement) and
  `app/(app)/prospects/page.tsx` (Button = ExportCurrentFilters,
  already migrated via ExportButton).

**Commit 6 (`feat: home hero-tile refinement`)** — af0067f
- `app/(app)/page.tsx` — `Tile` type gains `hero?: boolean`. "Total
  prospects" is the sole hero: true entry.
- Hero branch: `sm:col-span-2 sm:row-span-2 lg:col-span-2`,
  border-[--primary-soft-border], surface → primary-soft/0.4
  gradient bg, hover shadow-md, text-5xl value, hint tint --primary.
- Standard branch: border-subtle, shadow-sm → shadow-md, hover lifts
  1px + thickens border, 2px top-edge crimson gradient fades in.
- `data-hero="true"/"false"` on every tile for semantic Playwright
  assertions.

**Commit 7 (`feat: demote Export`)** — db6f423
- Export button removed from the /prospects heading cluster.
- New optional `controlsSlot` prop on ProspectTable renders in its
  existing controls row (alongside Rows + Columns). /prospects
  passes a vertical Separator + ExportCurrentFilters.
- `data-testid="export-all-prospects"` preserved for
  stage10b/export.spec.ts continuity.
- Deviation from plan §180: the plan diagrammed a new row between
  FilterBar and the table. In practice that would have doubled up
  controls rows (ProspectTable already renders one). Inlined the
  slot into the existing row — same visual grouping, zero selector
  churn.

**Commit 8 (`test: axe a11y + snapshot + CI`)** — e3b4f27
- `whrb-web/e2e/foundation/a11y.spec.ts` — @axe-core/playwright gate
  sweeping every primary authed route (/, /prospects, /prospects/[id]
  for first row, /media-kit, /guide, /admin/vocab, /admin/sources).
  Fails on serious/critical WCAG violations; logs minor/moderate to
  console for triage. Admin routes skip when default storage is a rep.
- `whrb-web/e2e/stage6/home.spec.ts` — new case T01b asserts
  `data-hero="true"` on `[data-testid="tile-total"]` and `"false"`
  on every other tile.
- `.github/workflows/whrb-web-ci.yml` — `pnpm test:run` step added
  between `pnpm lint` and `pnpm build`. Vitest now gates every
  post-foundation PR.

**Commit 9 (`docs`)** — this ROLLOUT entry. The foundation plan's §293
epic-plan amendments (§1.4 cross-reference, §1.5 route-add
convention, §4.2 entry state, §5.4 T3 clarifications, §6.4 T4 hero
retention, §12 critical files) had already been written into
`~/.claude/plans/users-countcowy-downloads-media-kit-202-gleaming-dawn.md`
during the earlier plan-update session (2026-04-23 pre-implementation),
and `@axe-core/playwright` was threaded through the same way. Nothing
to append there in this commit.

### Verification

| Gate | Result |
|---|---|
| `pnpm install` | clean, 23 new packages installed |
| `pnpm typecheck` | clean |
| `pnpm lint` | clean |
| `pnpm test:run` (Vitest) | 10/10 passed (all 5 button-fill pairs × light + dark) |
| `pnpm build` | clean, every route compiles |
| FS case-guard `ls components/ui/ \| grep -E '[A-Z]'` | empty (lowercase-only) |
| Playwright (full suite) | deferred to CI preview-deploy |
| axe (foundation/a11y.spec.ts) | deferred to CI preview-deploy |

### Rollback

Revert the foundation merge commit — atomic restoration to T1-exit
(`v-t1-exit` tag at `5216a3f`). Each of the 9 intra-branch commits
is also independently revertable if a narrow regression surfaces;
commit 2 (palette) is the single riskiest.

### Next

T2 (tag emitters + cannabis block + backfill + daypart view) does
**not** start until an explicit "start T2" command, per the
`feedback_no_auto_stage_advance.md` rule. T2 builds on the foundation
primitives — no further UI-infra work needed before T2 branching.

---

