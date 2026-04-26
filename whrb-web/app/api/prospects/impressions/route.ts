import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

const Body = z.object({
  prospect_ids: z.array(z.string().uuid()).min(1).max(500),
  filter_signature: z.string().max(120).optional(),
});

/**
 * POST /api/prospects/impressions
 *
 * Records that the current user actually saw a list of prospect rows
 * given their current filter URL. Inserts one row per prospect_id; the
 * `filter_impressions_daily_unique` index drops duplicates within the
 * same UTC day. Used by the source-quality `searched_rate` metric.
 *
 * Idempotent on the server (ON CONFLICT DO NOTHING via the unique
 * index). The client-side dedup via sessionStorage is the cheap
 * first-line defense; the index is the durable guarantee.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'invalid body' },
      { status: 400 },
    );
  }

  const rows = parsed.data.prospect_ids.map((id) => ({
    user_id: user.id,
    prospect_id: id,
    filter_signature: parsed.data.filter_signature ?? null,
  }));

  // ON CONFLICT (user_id, prospect_id, impression_date) DO NOTHING — let
  // the per-day unique index drop duplicates without us having to
  // pre-compute today's date here.
  const { error } = await supabase
    .from('filter_impressions')
    .upsert(rows, {
      onConflict: 'user_id,prospect_id,impression_date',
      ignoreDuplicates: true,
    });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, count: rows.length });
}
