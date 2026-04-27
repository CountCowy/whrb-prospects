import { NextResponse, type NextRequest } from 'next/server';

import { createServiceClient } from '@/lib/supabase/service';
import { getAuthed } from '@/lib/server/authz';
import { materializeRemindersForEvent } from '@/lib/server/schedule-reminders';

export const runtime = 'nodejs';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const authz = await getAuthed();
  if (authz.kind === 'unauth') {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  // Drop the caller's pending reminders for this event, then re-materialize
  // (the materialize helper resolves the recipient set; if the caller is
  // not currently a recipient, no rows are inserted for them).
  const service = createServiceClient();
  await service
    .from('schedule_event_reminders')
    .delete()
    .eq('event_id', id)
    .eq('recipient_id', authz.user.id)
    .is('dispatched_at', null);

  await materializeRemindersForEvent(id);
  return NextResponse.json({ ok: true });
}
