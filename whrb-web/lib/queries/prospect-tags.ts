import 'server-only';

import { createClient } from '@/lib/supabase/server';
import type { Axis } from '@/styles/tag-colors';

/**
 * One row out of `prospect_tags` joined to `tag_vocabulary`. Suppressed
 * rows (`suppressed_at IS NOT NULL`) are filtered out by every query
 * here so the chip layer never has to render the soft-clear state.
 */
export type ProspectTagView = {
  id: string;
  prospect_id: string;
  tag_id: string;
  axis: Axis;
  value: string;
  status: 'active' | 'pending_admin_review' | 'deprecated';
  created_by: string | null;
  locked_by: string | null;
  locked_at: string | null;
};

const SELECT =
  'id, prospect_id, tag_id, created_by, locked_by, locked_at, ' +
  'tag_vocabulary!inner(axis, value, status)';

type RawRow = {
  id: string;
  prospect_id: string;
  tag_id: string;
  created_by: string | null;
  locked_by: string | null;
  locked_at: string | null;
  tag_vocabulary: { axis: Axis; value: string; status: ProspectTagView['status'] } | null;
};

function flatten(rows: RawRow[]): ProspectTagView[] {
  return rows
    .filter((r): r is RawRow & { tag_vocabulary: NonNullable<RawRow['tag_vocabulary']> } => Boolean(r.tag_vocabulary))
    .map((r) => ({
      id: r.id,
      prospect_id: r.prospect_id,
      tag_id: r.tag_id,
      axis: r.tag_vocabulary.axis,
      value: r.tag_vocabulary.value,
      status: r.tag_vocabulary.status,
      created_by: r.created_by,
      locked_by: r.locked_by,
      locked_at: r.locked_at,
    }));
}

/** Sort key used in every consumer so axis groups stay stable. */
const AXIS_ORDER: Record<Axis, number> = {
  sector: 0,
  operating_model: 1,
  genre: 2,
  affiliation: 3,
  cadence: 4,
  daypart_fit: 5,
  history: 6,
  compliance: 7,
  other: 8,
};

export function sortTags(tags: ProspectTagView[]): ProspectTagView[] {
  return [...tags].sort((a, b) => {
    const ax = AXIS_ORDER[a.axis] ?? 99;
    const bx = AXIS_ORDER[b.axis] ?? 99;
    if (ax !== bx) return ax - bx;
    return a.value.localeCompare(b.value);
  });
}

export async function getTagsForProspect(
  prospectId: string,
): Promise<ProspectTagView[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('prospect_tags')
    .select(SELECT)
    .eq('prospect_id', prospectId)
    .is('suppressed_at', null);
  if (error) throw error;
  return sortTags(flatten((data ?? []) as unknown as RawRow[]));
}

/**
 * Bulk fetch tags for a list of prospect IDs. Returns a Map keyed by
 * prospect_id. Empty list short-circuits without hitting the DB.
 */
export async function getTagsForProspects(
  prospectIds: string[],
): Promise<Map<string, ProspectTagView[]>> {
  const out = new Map<string, ProspectTagView[]>();
  if (prospectIds.length === 0) return out;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('prospect_tags')
    .select(SELECT)
    .in('prospect_id', prospectIds)
    .is('suppressed_at', null);
  if (error) throw error;
  const flat = flatten((data ?? []) as unknown as RawRow[]);
  for (const t of flat) {
    const list = out.get(t.prospect_id) ?? [];
    list.push(t);
    out.set(t.prospect_id, list);
  }
  for (const [k, v] of out) out.set(k, sortTags(v));
  return out;
}

/**
 * Resolve `(axis, value)` filter sets to a list of `prospect_id`s that
 * have *all* requested values across *all* requested axes (AND across
 * axes, OR within axis — matches plan §5.5 semantics for Advanced
 * Filters). Returns null when no axis filter is active so callers can
 * skip the IN-clause and avoid an empty-set short-circuit.
 */
export async function resolveTagFilter(
  filter: Partial<Record<Axis, string[]>>,
): Promise<string[] | null> {
  const axes = (Object.entries(filter) as Array<[Axis, string[] | undefined]>)
    .filter(([, vals]) => Array.isArray(vals) && vals.length > 0) as Array<[Axis, string[]]>;
  if (axes.length === 0) return null;

  const supabase = await createClient();
  let intersection: Set<string> | null = null;
  for (const [axis, values] of axes) {
    const { data, error } = await supabase
      .from('prospect_tags')
      .select('prospect_id, tag_vocabulary!inner(axis, value)')
      .is('suppressed_at', null)
      .eq('tag_vocabulary.axis', axis)
      .in('tag_vocabulary.value', values);
    if (error) throw error;
    const ids = new Set<string>();
    for (const row of (data ?? []) as Array<{ prospect_id: string }>) {
      ids.add(row.prospect_id);
    }
    if (intersection === null) {
      intersection = ids;
    } else {
      const prior: Set<string> = intersection;
      intersection = new Set(Array.from(prior).filter((x) => ids.has(x)));
    }
    if (intersection.size === 0) break;
  }
  return intersection ? Array.from(intersection) : null;
}

/**
 * Daypart filter — joins through `prospect_daypart` view (T2 migration
 * 008). Returns prospect_ids whose derived daypart array includes any
 * of the requested values.
 */
export async function resolveDaypartFilter(
  values: string[],
): Promise<string[] | null> {
  if (values.length === 0) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('prospect_daypart')
    .select('prospect_id, daypart_fit')
    .overlaps('daypart_fit', values);
  if (error) throw error;
  return ((data ?? []) as Array<{ prospect_id: string }>).map((r) => r.prospect_id);
}
