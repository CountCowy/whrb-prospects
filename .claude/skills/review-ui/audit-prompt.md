# UI audit prompt (fixed, versioned)

You are doing a strict code review of an in-flight UI migration in the
`whrb-web/` Next.js 15 + React 19 + Tailwind v4 + shadcn/Radix app.
The repo uses warm hue-30 palette CSS vars, lowercase shadcn primitives
in `whrb-web/components/ui/`, and a `cn()` helper at `whrb-web/lib/utils.ts`.

**Scope.** Only the files listed in the block below the prompt. Read each
one and its nearest consumers via `git diff origin/main...HEAD -- <file>`.

## Categories

Find every bug falling into these categories. Use the exact category name
in your finding output.

1. **grid-span-misplacement**
   Tailwind grid/flex span / col / row classes applied to the wrong
   element (e.g., `sm:col-span-2 sm:row-span-2` on a grid-child wrapper
   when the grid parent expects the spans on its direct children).
   Motivating example: hero tile rendered 1×1 because the span was on
   the inner card, not the `<Link>` child of the grid.

2. **radix-aschild-violation**
   A Radix `asChild` prop composing onto a non-ref-forwarding child,
   or with multiple direct children, or wrapping a `Link` that itself
   has padding/flex classes conflicting with the primitive's cva.

3. **testid-drift**
   `data-testid` / `aria-label` / `role` regressions vs. the
   pre-migration version — in particular, any e2e selector used under
   `whrb-web/e2e/**/*.spec.ts` that no longer matches.

4. **radix-replacement-gap**
   A hand-rolled modal/popover/menu migrated to a Radix primitive but
   leaving behind legacy click-outside handlers, focus traps, or
   ESC-close listeners that the primitive already provides (double
   handling causes flicker + a11y bugs).

5. **half-migration**
   A shadcn primitive imported at the top of a file but never rendered
   (stub migrations), or rendered alongside the hand-rolled old
   component (both live in the DOM).

6. **hand-rolled-next-to-shadcn**
   A bespoke markup-only component that's now visually inconsistent
   next to its shadcn-migrated siblings (e.g., plain `<button class="px-3 py-1 rounded">`
   when every other button is `<Button variant="outline">`).

7. **css-token-alpha-compose**
   Applying alpha in Tailwind arbitrary-value syntax to a CSS var that
   already has alpha, producing black/white collapse.
   Motivating example: `hsl(var(--primary-soft) / 0.4)` when
   `--primary-soft` was already defined as `hsl(… / 0.35)` —
   multiplies to ~0.14 and renders near-transparent.

8. **source-branch-design-drift**
   A migration that copied the shadcn primitive but dropped the source
   branch's design intent (icons removed from nav tabs,
   framer-motion transitions deleted, tab underline vs. pill style
   swapped without reason).

9. **hardcoded-size-vs-cva**
   Explicit `h-[Npx]` / `w-[Npx]` / `text-[Npx]` classes on children of
   a shadcn Button / Badge / etc. whose cva variant already sets the
   size — the last-imported class wins via JIT, producing intermittent
   size drift across builds.
   Motivating example: `<Bell h-[18px] w-[18px] />` inside
   `<Button variant="icon">` whose cva includes `[&_svg]:size-4`.

10. **palette-contrast-drift**
    A bg/fg token pair that computes below WCAG AA 4.5:1 for normal
    text (or 3:1 for large text / non-text UI). Check against
    `whrb-web/app/globals.css` warm-palette HSL values and the
    contrast assertions in `whrb-web/lib/__tests__/palette-contrast.test.ts`.

## Severity

- **critical** — Rendering breaks for a majority of users / loses functionality / breaks a11y in a load-bearing control. Examples: hero tile collapsed, nav tabs disappear, login button unreachable by keyboard.
- **high** — Rendering breaks for an edge case OR visually incorrect for every user but not load-bearing. Examples: column-menu label-click unresponsive, icon sized inconsistently across builds, focus-ring missing on a secondary control.
- **medium** — Cosmetic drift or a11y softness; doesn't block a user flow. Examples: mismatched hover states, a secondary tile's border off, a warning-state badge 3 % darker than spec.
- **low** — Minor polish items, e.g., spacing off by 2 px.
- **nit** — Style preferences, naming conventions, comment gaps.

Map every finding to exactly one severity. Prefer *over*-reporting at the
medium/low bar; the hook only blocks on critical + high, so a medium
flag is costless to a green PR.

## Required output format

Print findings as a numbered list, each with:

```
N. [severity] [category] <file>:<line> — <one-sentence summary>
    Fix: <concrete code-level suggestion>
```

End the response with a machine-parseable findings block. The exact
delimiter text is load-bearing — the skill parser extracts on it.

```
=== FINDINGS-JSON-START ===
{
  "critical": [
    { "file": "whrb-web/app/(app)/page.tsx", "line": 42, "category": "grid-span-misplacement", "summary": "Hero tile spans 1x1 because sm:col-span-2 is on the inner Card, not the Link grid-child." }
  ],
  "high":     [],
  "medium":   [],
  "low":      [],
  "nit":      []
}
=== FINDINGS-JSON-END ===
```

Every array must be present even if empty. Use `"category"` strings
from the list above verbatim (lowercase, hyphen-separated).
