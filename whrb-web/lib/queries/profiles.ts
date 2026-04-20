import 'server-only';

import { createClient } from '@/lib/supabase/server';

export type Profile = {
  id: string;
  email: string;
  display_name: string | null;
  role: 'admin' | 'rep';
  created_at: string;
};

export type ProfileWithCounts = Profile & {
  assigned_count: number;
  sold_count: number;
};

export async function listProfilesWithCounts(): Promise<ProfileWithCounts[]> {
  const supabase = await createClient();
  const [{ data: profiles, error: pErr }, { data: assigned, error: aErr }, { data: sold, error: sErr }] =
    await Promise.all([
      supabase.from('profiles').select('*').order('created_at', { ascending: true }),
      supabase.from('prospects').select('assigned_to').not('assigned_to', 'is', null),
      supabase.from('prospects').select('assigned_to').eq('state', 'sold').not('assigned_to', 'is', null),
    ]);
  if (pErr) throw pErr;
  if (aErr) throw aErr;
  if (sErr) throw sErr;

  const assignedCount = new Map<string, number>();
  for (const row of assigned ?? []) {
    const id = row.assigned_to as string;
    assignedCount.set(id, (assignedCount.get(id) ?? 0) + 1);
  }
  const soldCount = new Map<string, number>();
  for (const row of sold ?? []) {
    const id = row.assigned_to as string;
    soldCount.set(id, (soldCount.get(id) ?? 0) + 1);
  }
  return (profiles ?? []).map((p) => ({
    ...(p as Profile),
    assigned_count: assignedCount.get(p.id as string) ?? 0,
    sold_count: soldCount.get(p.id as string) ?? 0,
  }));
}

export async function getProfile(id: string): Promise<Profile | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from('profiles').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return (data ?? null) as Profile | null;
}
