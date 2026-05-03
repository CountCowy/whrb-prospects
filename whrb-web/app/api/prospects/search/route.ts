import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';
import { getAuthed } from '@/lib/server/authz';

export const runtime = 'nodejs';

/**
 * GET /api/prospects/search?q=<term>&limit=20
 *
 * Cheap typeahead for the ad-order Company field. Returns prospects whose
 * company_name matches `q` (ILIKE %term%), capped at `limit` (max 50).
 * RLS-honoured via the cookie client. Empty `q` returns the most recent
 * prospects so an empty dropdown still has something useful to show.
 */
export async function GET(req: Request) {
  const authz = await getAuthed();
  if (authz.kind === 'unauth') {
    return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });
  }

  const url = new URL(req.url);
  const rawQ = (url.searchParams.get('q') ?? '').trim();
  // Strip LIKE wildcards + PostgREST or-clause syntax chars so a crafted
  // term can't escape the ILIKE filter (matches the ad-orders search hardening).
  const q = rawQ.replace(/[%_,().":*]/g, '');
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit') ?? 20)));

  const supabase = await createClient();
  let query = supabase
    .from('prospects')
    .select('id, company_name, tier, state')
    .order('company_name', { ascending: true })
    .limit(limit);

  if (q) {
    query = query.ilike('company_name', `%${q}%`);
  } else {
    query = supabase
      .from('prospects')
      .select('id, company_name, tier, state')
      .order('created_at', { ascending: false })
      .limit(limit);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ prospects: data ?? [] });
}
