import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { createClient } from '@/lib/supabase/server';
import { getAuthed } from '@/lib/server/authz';

export const runtime = 'nodejs';

const PutBody = z.object({
  overrides: z
    .array(
      z.object({
        lead_minutes: z.number().int().min(0).max(43200),
        channel: z.enum(['in_app', 'email']),
      }),
    )
    .max(20)
    .nullable(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const authz = await getAuthed();
  if (authz.kind === 'unauth') {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('schedule_event_reminders')
    .select('*')
    .eq('event_id', id)
    .eq('recipient_id', authz.user.id)
    .order('lead_minutes', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data ?? [] });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const authz = await getAuthed();
  if (authz.kind === 'unauth') {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const json = await req.json().catch(() => null);
  const parsed = PutBody.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json(
      { error: `invalid: ${issue.path.join('.')} — ${issue.message}` },
      { status: 400 },
    );
  }
  const supabase = await createClient();

  // Wipe existing pending reminders for this user × event so we can replace
  // them with the override set. Dispatched rows are immutable history.
  await supabase
    .from('schedule_event_reminders')
    .delete()
    .eq('event_id', id)
    .eq('recipient_id', authz.user.id)
    .is('dispatched_at', null);

  const overrides = parsed.data.overrides;
  if (overrides && overrides.length > 0) {
    const rows = overrides.map((o) => ({
      event_id: id,
      recipient_id: authz.user.id,
      channel: o.channel,
      lead_minutes: o.lead_minutes,
      // fire_at overwritten by the trigger.
      fire_at: new Date(0).toISOString(),
    }));
    const { error } = await supabase
      .from('schedule_event_reminders')
      .upsert(rows, {
        onConflict: 'event_id,recipient_id,channel,lead_minutes',
        ignoreDuplicates: true,
      });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }
  return NextResponse.json({ ok: true });
}
