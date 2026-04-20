import 'server-only';

import { createClient } from '@/lib/supabase/server';

export type NoteRow = {
  id: string;
  prospect_id: string;
  author_id: string;
  body: string;
  edited_at: string | null;
  deleted_at: string | null;
  deleted_by: string | null;
  created_at: string;
  author?: { id: string; email: string; display_name: string | null } | null;
  prospect?: { id: string; company_name: string } | null;
};

export async function listNotesForProspect(prospectId: string): Promise<NoteRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('prospect_notes')
    .select('*, author:profiles!author_id(id,email,display_name)')
    .eq('prospect_id', prospectId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as NoteRow[];
}

export async function listRecentActivity(limit = 10): Promise<NoteRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('prospect_notes')
    .select(
      '*, author:profiles!author_id(id,email,display_name), prospect:prospects!prospect_id(id,company_name)',
    )
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as unknown as NoteRow[];
}
