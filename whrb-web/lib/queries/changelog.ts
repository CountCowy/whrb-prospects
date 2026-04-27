import 'server-only';

import { createClient } from '@/lib/supabase/server';

export type ChangelogEntry = {
  id: string;
  slug: string;
  title: string;
  body_mdx: string;
  audience: 'rep' | 'admin' | 'all';
  released_at: string;
  pinned: boolean;
  created_by: string | null;
  created_at: string;
};

export async function listChangelogEntries(): Promise<ChangelogEntry[]> {
  const supabase = await createClient();
  // RLS already filters to entries the viewer should see.
  const { data, error } = await supabase
    .from('changelog_entries')
    .select('*')
    .order('pinned', { ascending: false })
    .order('released_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []) as ChangelogEntry[];
}

export async function getPendingChangelogForUser(): Promise<{
  slug: string;
  title: string;
  released_at: string;
} | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, last_changelog_ack')
    .eq('id', user.id)
    .maybeSingle();
  if (!profile) return null;

  const lastAck = (profile.last_changelog_ack as string | null) ?? null;
  let q = supabase
    .from('changelog_entries')
    .select('slug, title, released_at, audience')
    .order('pinned', { ascending: false })
    .order('released_at', { ascending: false })
    .limit(1);
  if (lastAck) q = q.gt('released_at', lastAck);
  const { data, error } = await q;
  if (error || !data || data.length === 0) return null;
  const row = data[0] as {
    slug: string;
    title: string;
    released_at: string;
  };
  return row;
}
