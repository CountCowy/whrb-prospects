import 'server-only';

import { createClient } from '@/lib/supabase/server';

export type ActivityEntry = {
  id: string;
  created_at: string;
  category: string | null;
  level: string;
  message: string;
  context: Record<string, unknown>;
  user_id: string | null;
  actor_label: string | null;
};

const PROSPECT_CATEGORIES = [
  'prospect_field_change',
  'prospect_state_change',
  'prospect_assignment_change',
];

const NOTE_CATEGORIES = ['note_deleted', 'note_restored'];

export async function listActivityForProspect(
  prospectId: string,
  opts: { includeDeletedNoteHistory?: boolean } = {},
): Promise<ActivityEntry[]> {
  const supabase = await createClient();
  const categories = [...PROSPECT_CATEGORIES];
  if (opts.includeDeletedNoteHistory) categories.push(...NOTE_CATEGORIES);

  const { data, error } = await supabase
    .from('event_log')
    .select('id,created_at,category,level,message,context,user_id')
    .in('category', categories)
    .contains('context', { prospect_id: prospectId })
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) throw error;

  const actorIds = Array.from(
    new Set(
      (data ?? [])
        .map((r) => (r.context as { actor_id?: string })?.actor_id)
        .filter((v): v is string => typeof v === 'string'),
    ),
  );

  let labelMap: Record<string, string> = {};
  if (actorIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id,email,display_name')
      .in('id', actorIds);
    labelMap = Object.fromEntries(
      (profiles ?? []).map((p) => [
        p.id as string,
        (p.display_name as string | null) ||
          ((p.email as string) ?? '').split('@')[0] ||
          'Unknown',
      ]),
    );
  }

  return (data ?? []).map((row) => {
    const ctx = (row.context as Record<string, unknown>) ?? {};
    const actorId = (ctx.actor_id as string | undefined) ?? null;
    return {
      id: row.id as string,
      created_at: row.created_at as string,
      category: row.category as string | null,
      level: row.level as string,
      message: row.message as string,
      context: ctx,
      user_id: (row.user_id as string | null) ?? null,
      actor_label: actorId ? labelMap[actorId] ?? null : null,
    };
  });
}
