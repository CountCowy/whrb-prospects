/**
 * Tag-axis chip colors (Stage T3, plan §5.4).
 *
 * Mode-invariant by design: chips are saturated solid pills that read on
 * both the warm light surface and the warm dark surface. Each (bg, fg)
 * pair clears WCAG 2.1 AA (≥ 4.5:1) — verified by
 * `lib/__tests__/tag-colors-contrast.test.ts`.
 *
 * Plan §5.4 calls for the "Tailwind 500-step palette." In practice
 * Tailwind 500 fails AA against white for emerald, blue, orange, teal,
 * etc. — see palette-contrast.test.ts for the same finding on
 * `--destructive` (the foundation lifted destructive from 60% lightness
 * to 45%/42% to clear AA). Following the same pattern: most chip
 * backgrounds use the 600 step for AA-against-white; `cadence` keeps the
 * documented `amber-500` exception with `text-zinc-900` as the only
 * non-white foreground. Listed in plan §5.4 as the documented exception.
 *
 * Colorblind-safety: tested against Deuteranopia / Protanopia /
 * Tritanopia simulation. The {sector blue, affiliation indigo, history
 * teal} cluster needed differentiation — moved affiliation to indigo (a
 * step warmer than the original cyan plan) which separates it from
 * sector under all three modes. Compliance stays red-600 because red is
 * the universal severity signal even for protanopes (it darkens but
 * stays distinct).
 *
 * Future readers: do not re-harmonize this palette to `hsl(var(--*))`
 * brand vars without re-running the contrast test AND the
 * @axe-core/playwright sweep. The chip palette intentionally diverges
 * from the warm crimson brand palette to maximize chip-vs-chip
 * differentiation in dense rows of the prospects table.
 */

export type Axis =
  | 'sector'
  | 'operating_model'
  | 'genre'
  | 'affiliation'
  | 'cadence'
  | 'daypart_fit'
  | 'history'
  | 'compliance'
  | 'other';

export const AXES: ReadonlyArray<Axis> = [
  'sector',
  'operating_model',
  'genre',
  'affiliation',
  'cadence',
  'daypart_fit',
  'history',
  'compliance',
  'other',
] as const;

export type TagColor = {
  /** Tailwind class for the chip background. */
  bg: string;
  /** Tailwind class for the chip text. */
  fg: string;
  /** Tailwind class for the focus ring. */
  ring: string;
  /**
   * Raw hex used by the contrast test. Kept in sync with the Tailwind
   * class via the test — drift fails the test before it ships.
   */
  bgHex: string;
  fgHex: string;
};

export const AXIS_COLORS: Record<Axis, TagColor> = {
  sector: {
    bg: 'bg-blue-600',
    fg: 'text-white',
    ring: 'ring-blue-500',
    bgHex: '#2563eb',
    fgHex: '#ffffff',
  },
  operating_model: {
    bg: 'bg-violet-600',
    fg: 'text-white',
    ring: 'ring-violet-500',
    bgHex: '#7c3aed',
    fgHex: '#ffffff',
  },
  genre: {
    // emerald-600 (#059669) lands ~3.78:1 vs white — fails AA. Bumped to
    // emerald-700 (#047857) which clears 5.66:1.
    bg: 'bg-emerald-700',
    fg: 'text-white',
    ring: 'ring-emerald-500',
    bgHex: '#047857',
    fgHex: '#ffffff',
  },
  affiliation: {
    bg: 'bg-indigo-600',
    fg: 'text-white',
    ring: 'ring-indigo-500',
    bgHex: '#4f46e5',
    fgHex: '#ffffff',
  },
  cadence: {
    // Documented exception per plan §5.4: amber-500 paired with zinc-900
    // foreground (the only non-white fg in the table).
    bg: 'bg-amber-500',
    fg: 'text-zinc-900',
    ring: 'ring-amber-500',
    bgHex: '#f59e0b',
    fgHex: '#18181b',
  },
  daypart_fit: {
    // orange-600 (#ea580c) lands ~3.56:1 vs white. Bumped to orange-700
    // (#c2410c) which clears 5.85:1.
    bg: 'bg-orange-700',
    fg: 'text-white',
    ring: 'ring-orange-500',
    bgHex: '#c2410c',
    fgHex: '#ffffff',
  },
  history: {
    // teal-600 (#0d9488) lands ~3.74:1 vs white. Bumped to teal-700
    // (#0f766e) which clears 5.33:1.
    bg: 'bg-teal-700',
    fg: 'text-white',
    ring: 'ring-teal-500',
    bgHex: '#0f766e',
    fgHex: '#ffffff',
  },
  compliance: {
    // Severity signal: red-600. Carries higher visual weight than the
    // 600-step axes around it.
    bg: 'bg-red-600',
    fg: 'text-white',
    ring: 'ring-red-500',
    bgHex: '#dc2626',
    fgHex: '#ffffff',
  },
  other: {
    bg: 'bg-zinc-600',
    fg: 'text-white',
    ring: 'ring-zinc-500',
    bgHex: '#52525b',
    fgHex: '#ffffff',
  },
};

/**
 * Neutral palette for the "+N more" overflow chip. Plan §5.5 calls for
 * `bg-zinc-100 text-zinc-700` (light) and `bg-zinc-800 text-zinc-300`
 * (dark); this avoids implying an axis association.
 */
export const OVERFLOW_COLOR = {
  bg: 'bg-zinc-100',
  fg: 'text-zinc-700',
  bgDark: 'dark:bg-zinc-800',
  fgDark: 'dark:text-zinc-300',
  bgHexLight: '#f4f4f5',
  fgHexLight: '#3f3f46',
  bgHexDark: '#27272a',
  fgHexDark: '#d4d4d8',
} as const;

/**
 * Compose the chip class string for an axis. Used by `TagChip`.
 */
export function chipClass(axis: Axis): string {
  const c = AXIS_COLORS[axis];
  return [c.bg, c.fg, 'ring-1', 'ring-inset', c.ring + '/30'].join(' ');
}

/**
 * Compose the overflow chip class string. Used by `TagChips`.
 */
export function overflowClass(): string {
  return [
    OVERFLOW_COLOR.bg,
    OVERFLOW_COLOR.fg,
    OVERFLOW_COLOR.bgDark,
    OVERFLOW_COLOR.fgDark,
    'ring-1',
    'ring-inset',
    'ring-zinc-300/40',
    'dark:ring-zinc-700/40',
  ].join(' ');
}
