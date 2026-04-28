import { NextResponse, type NextRequest } from 'next/server';

import { createClient } from '@/lib/supabase/server';
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

  // Verify the caller can SEE the event before doing any side effects.
  // Using the user's RLS client means a non-recipient gets a 404 here
  // instead of triggering a silent recipient-set rematerialization.
  const supabase = await createClient();
  const { data: existing } = await supabase
    .from('schedule_events')
    .select('id')
    .eq('id', id)
    .maybeSingle();
  if (!existing) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  // Drop the caller's pending reminders for this event using their own
  // RLS-enforced client (recipient_id = self is the policy on writes).
  await supabase
    .from('schedule_event_reminders')
    .delete()
    .eq('event_id', id)
    .eq('recipient_id', authz.user.id)
    .is('dispatched_at', null);

  // Materialize ONLY for the caller. Without `recipientId` this would
  // re-run the full team_wide / admin recipient set, which (a) is wasteful
  // and (b) gives any logged-in user a knob to fan out reminder writes
  // to other recipients on any event UUID they happen to know.
  await materializeRemindersForEvent(id, authz.user.id);
  return NextResponse.json({ ok: true });
}
