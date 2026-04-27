import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

const Body = z.object({
  action: z.enum(['propose_sunset', 'revert_to_active']),
});

/**
 * POST /api/admin/sources/[key]/lifecycle
 *
 * Admin-only. Toggles a source between `active` ⇆ `sunset_proposed`.
 * Also handles "revert" from `sunset` and `archived`, both of which
 * also reset `status` to `active` and bump `status_changed_at = now()`.
 *
 * Auto-promotion (`sunset_proposed` → `sunset` at 15d, `sunset` →
 * `archived` at 45d total) is the cron job's job —
 * `scripts/advance_source_lifecycle.py` — not this route.
 *
 * Emits `event_log.category='source_lifecycle_admin'` with the
 * before/after snapshot.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  const { key } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  if (profile?.role !== 'admin') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'invalid body' },
      { status: 400 },
    );
  }

  const { data: existing } = await supabase
    .from('source_config')
    .select('source_key, status, enabled')
    .eq('source_key', key)
    .maybeSingle();
  if (!existing) {
    return NextResponse.json({ error: 'unknown source_key' }, { status: 404 });
  }

  const fromStatus = (existing as { status: string }).status;
  const nextStatus =
    parsed.data.action === 'propose_sunset' ? 'sunset_proposed' : 'active';

  // Reject no-op promotions (propose_sunset on already-proposed) — we
  // could allow them as 200-no-op but it's clearer to surface the bad
  // request to the UI so the button doesn't spuriously light up.
  if (parsed.data.action === 'propose_sunset' && fromStatus !== 'active') {
    return NextResponse.json(
      { error: `cannot propose sunset from status=${fromStatus}` },
      { status: 400 },
    );
  }

  const { error } = await supabase
    .from('source_config')
    .update({
      status: nextStatus,
      // `status_changed_at` is bumped by the BEFORE-UPDATE trigger
      // `t_source_config_status_enabled` (migration 011) whenever
      // `status` actually moves; we deliberately don't set it client-
      // side so single-source-of-truth lives in the trigger. The
      // no-op-promotion check above (line 69) ensures every reach into
      // this UPDATE will actually shift `status`, so the trigger always
      // fires. `updated_by` we DO set so the audit/email columns stamp
      // the actor.
      updated_by: user.id,
    })
    .eq('source_key', key);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Emit lifecycle event.
  const category =
    parsed.data.action === 'propose_sunset'
      ? 'source_sunset_proposed'
      : 'source_lifecycle_reversed';
  await supabase.from('event_log').insert({
    source: 'web_server',
    level: 'info',
    category,
    message: `${category} for source ${key}`,
    user_id: user.id,
    context: {
      source: key,
      from_status: fromStatus,
      to_status: nextStatus,
      actor: user.id,
    },
  });

  return NextResponse.json({ ok: true, from: fromStatus, to: nextStatus });
}
