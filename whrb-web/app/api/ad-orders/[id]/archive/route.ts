import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/server/authz';
import { logEvent } from '@/lib/logging/server';
import { clearAdOrderScheduleEvents } from '@/lib/server/ad-order-schedule';

export const runtime = 'nodejs';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authz = await requireAdmin();
  if (authz.kind === 'unauth') return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });
  if (authz.kind === 'forbidden') return NextResponse.json({ error: 'Admin role required.' }, { status: 403 });

  const { id } = await params;
  const user = authz.user;

  const supabase = await createClient();
  const { error } = await supabase
    .from('ad_orders')
    .update({ archived_at: new Date().toISOString(), archived_by: user.id })
    .eq('id', id);

  if (error) {
    await logEvent({
      source: 'web_server',
      level: error.code === '42501' ? 'warn' : 'error',
      category: 'ad_order_archive_failed',
      message: 'archive failed',
      context: { id, code: error.code, message: error.message },
      userId: user.id,
    });
    return NextResponse.json({ error: error.message }, { status: error.code === '42501' ? 403 : 400 });
  }

  // Best-effort: drop the linked schedule_events.
  await clearAdOrderScheduleEvents(id);

  return NextResponse.json({ ok: true });
}
