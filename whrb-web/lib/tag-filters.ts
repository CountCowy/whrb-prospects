/**
 * Tag-filter URL helpers used by the rep UI (Stage T3, plan §5.5).
 *
 * Convention: each axis filter is a single URL param named
 *   `tags_<axis>` (e.g. `tags_genre=classical,opera`).
 * Multiple values within an axis are comma-joined → OR semantics.
 * Multiple axes → AND semantics.
 *
 * `daypart` is split off to `dp=<value>` because the daypart values
 * resolve through the SQL view, not directly through `prospect_tags`.
 *
 * The presets in `TAG_PRESETS` translate to one of these URL shapes
 * each. The `applyPreset()` helper layers a preset over an existing
 * URLSearchParams, replacing only the keys the preset owns. This keeps
 * the two preset mechanisms (URL state-only + advanced filters) cleanly
 * composable.
 */

import { AXES, type Axis } from '@/styles/tag-colors';

export const TAG_PARAM_PREFIX = 'tags_';
export const DAYPART_PARAM = 'dp';

export type TagFilterState = {
  byAxis: Partial<Record<Axis, string[]>>;
  daypart: string[];
};

export function readTagFilterFromParams(
  params: URLSearchParams | { get(name: string): string | null },
): TagFilterState {
  const out: TagFilterState = { byAxis: {}, daypart: [] };
  for (const axis of AXES) {
    const raw = params.get(TAG_PARAM_PREFIX + axis);
    if (!raw) continue;
    const values = raw.split(',').map((s) => s.trim()).filter(Boolean);
    if (values.length > 0) out.byAxis[axis] = values;
  }
  const dp = params.get(DAYPART_PARAM);
  if (dp) {
    out.daypart = dp.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return out;
}

export function writeTagFilterToParams(
  state: TagFilterState,
  base: URLSearchParams,
): URLSearchParams {
  const next = new URLSearchParams(base.toString());
  for (const axis of AXES) {
    next.delete(TAG_PARAM_PREFIX + axis);
  }
  next.delete(DAYPART_PARAM);
  for (const axis of AXES) {
    const values = state.byAxis[axis] ?? [];
    if (values.length > 0) {
      next.set(TAG_PARAM_PREFIX + axis, values.join(','));
    }
  }
  if (state.daypart.length > 0) {
    next.set(DAYPART_PARAM, state.daypart.join(','));
  }
  return next;
}

export type TagPreset = {
  /** Stable id used as the React key + URL `?preset=` value when active. */
  id: string;
  label: string;
  /** Tooltip / sub-label rendered under the chip. */
  hint: string;
  /**
   * Url params the preset injects. Other params on the URL are
   * preserved (so the user can layer search + preset).
   */
  params: Record<string, string>;
};

export const TAG_PRESETS: ReadonlyArray<TagPreset> = [
  {
    id: 'ready_today',
    label: 'Ready to call today',
    hint: 'Initial-contact state, assigned to me',
    params: {
      state: 'initial_contact',
    },
  },
  {
    id: 'classical_anchors',
    label: 'Classical anchors',
    hint: 'Tier A anchors with classical/choral/opera reach',
    params: {
      tier: 'A',
      [TAG_PARAM_PREFIX + 'genre']: 'classical,choral,opera',
    },
  },
  {
    id: 'harvard_adjacent',
    label: 'Harvard-adjacent',
    hint: 'Anyone tagged harvard_affiliated',
    params: {
      [TAG_PARAM_PREFIX + 'affiliation']: 'harvard_affiliated',
    },
  },
  {
    id: 'gone_quiet',
    label: 'Prior clients gone quiet',
    hint: 'Previous-client state — re-warm campaign candidates',
    params: {
      state: 'previous_client',
    },
  },
  {
    id: 'seasonal_now',
    label: 'Seasonal — call this month',
    hint: 'Cadence tag matches the current month',
    params: {
      [TAG_PARAM_PREFIX + 'cadence']: seasonalCadenceForToday(),
    },
  },
] as const;

/**
 * Map current month (0–11) to the seasonality_window cadence tag the
 * pipeline emits. Same windows used by `pipeline.seasonality_for()`.
 */
function seasonalCadenceForToday(): string {
  const month = new Date().getMonth();
  // Mar–May = spring; Jun–Aug = summer; Sep–Nov = fall; Dec–Feb = winter.
  if (month >= 2 && month <= 4) return 'spring';
  if (month >= 5 && month <= 7) return 'summer';
  if (month >= 8 && month <= 10) return 'fall';
  return 'winter';
}

export function buildPresetUrl(
  preset: TagPreset,
  base: URLSearchParams,
): URLSearchParams {
  const next = new URLSearchParams(base.toString());
  // Wipe the keys this preset owns so re-applying with different values
  // doesn't accumulate stale entries.
  for (const k of Object.keys(preset.params)) next.delete(k);
  for (const [k, v] of Object.entries(preset.params)) next.set(k, v);
  next.delete('page');
  next.set('preset', preset.id);
  return next;
}

export function clearPresetFromParams(base: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(base.toString());
  next.delete('preset');
  for (const preset of TAG_PRESETS) {
    for (const k of Object.keys(preset.params)) next.delete(k);
  }
  return next;
}
