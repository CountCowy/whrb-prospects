import 'server-only';

import { createClient } from '@/lib/supabase/server';

export type VocabAxis =
  | 'sector'
  | 'operating_model'
  | 'genre'
  | 'affiliation'
  | 'cadence'
  | 'daypart_fit'
  | 'history'
  | 'compliance'
  | 'other';

export type VocabStatus = 'active' | 'pending_admin_review' | 'deprecated';

export type VocabRow = {
  id: string;
  axis: VocabAxis;
  value: string;
  status: VocabStatus;
  replacement_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export const VOCAB_AXES: ReadonlyArray<VocabAxis> = [
  'sector',
  'operating_model',
  'genre',
  'affiliation',
  'cadence',
  'daypart_fit',
  'history',
  'compliance',
  'other',
];

export async function listVocab(): Promise<VocabRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('tag_vocabulary')
    .select(
      'id, axis, value, status, replacement_id, created_by, created_at, updated_at',
    )
    .order('axis', { ascending: true })
    .order('value', { ascending: true });
  if (error) throw error;
  return (data ?? []) as VocabRow[];
}

export function groupByAxis(rows: VocabRow[]): Map<VocabAxis, VocabRow[]> {
  const map = new Map<VocabAxis, VocabRow[]>();
  for (const axis of VOCAB_AXES) map.set(axis, []);
  for (const row of rows) {
    const list = map.get(row.axis);
    if (list) list.push(row);
  }
  return map;
}
