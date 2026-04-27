/**
 * Schedule-event category colors.
 *
 * Modeled on `styles/tag-colors.ts`: solid, mode-invariant chip pills that
 * pass WCAG 2.1 AA on both the warm light and warm dark surfaces.
 * Verified by `lib/__tests__/schedule-colors-contrast.test.ts`.
 *
 * Colorblind-safe: the palette intentionally diverges from existing tag
 * axis colors so a calendar event chip is never confused with a tag chip
 * in dense rows that contain both (e.g. on the home dashboard).
 */

export type ScheduleCategory =
  | 'sold_ad_airing'
  | 'client_recontact'
  | 'invoice_due'
  | 'internal_event'
  | 'personal_task'
  | 'other';

export const SCHEDULE_CATEGORIES: ReadonlyArray<ScheduleCategory> = [
  'sold_ad_airing',
  'client_recontact',
  'invoice_due',
  'internal_event',
  'personal_task',
  'other',
] as const;

export type ScheduleColor = {
  bg: string;
  fg: string;
  ring: string;
  bgHex: string;
  fgHex: string;
};

export const SCHEDULE_COLORS: Record<ScheduleCategory, ScheduleColor> = {
  sold_ad_airing: {
    bg: 'bg-emerald-700',
    fg: 'text-white',
    ring: 'ring-emerald-600',
    bgHex: '#047857',
    fgHex: '#ffffff',
  },
  client_recontact: {
    bg: 'bg-amber-500',
    fg: 'text-zinc-900',
    ring: 'ring-amber-400',
    bgHex: '#f59e0b',
    fgHex: '#18181b',
  },
  invoice_due: {
    bg: 'bg-red-600',
    fg: 'text-white',
    ring: 'ring-red-500',
    bgHex: '#dc2626',
    fgHex: '#ffffff',
  },
  internal_event: {
    bg: 'bg-violet-600',
    fg: 'text-white',
    ring: 'ring-violet-500',
    bgHex: '#7c3aed',
    fgHex: '#ffffff',
  },
  personal_task: {
    bg: 'bg-sky-600',
    fg: 'text-white',
    ring: 'ring-sky-500',
    bgHex: '#0284c7',
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

export const CATEGORY_LABELS: Record<ScheduleCategory, string> = {
  sold_ad_airing: 'Ad airing',
  client_recontact: 'Recontact',
  invoice_due: 'Invoice due',
  internal_event: 'Internal',
  personal_task: 'Personal task',
  other: 'Other',
};
