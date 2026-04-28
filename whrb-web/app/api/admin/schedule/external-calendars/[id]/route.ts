import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/server/authz';
import { logEvent } from '@/lib/logging/server';
import { validateFeedUrl } from '@/lib/server/safe-feed-url';
import { SCHEDULE_CATEGORIES } from '@/styles/schedule-colors';

export const runtime = 'nodejs';

const PatchBody = z
  .object({
    name: z.string().min(1).max(200).optional(),
    feed_url: z.string().url().max(2048).optional(),
    default_category: z
      .enum(SCHEDULE_CATEGORIES as unknown as [string, ...string[]])
      .optional(),
    default_assignee_kind: z.enum(['user', 'team_wide', 'admin']).optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const r = await requireAdmin();
  if (r.kind === 'unauth') {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  if (r.kind === 'forbidden') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const json = await req.json().catch(() => null);
  const parsed = PatchBody.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json(
      { error: `invalid: ${issue.path.join('.')} — ${issue.message}` },
      { status: 400 },
    );
  }
  if (parsed.data.feed_url) {
    const urlCheck = validateFeedUrl(parsed.data.feed_url);
    if (!urlCheck.ok) {
      return NextResponse.json({ error: urlCheck.error }, { status: 400 });
    }
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('schedule_external_calendars')
    .update(parsed.data)
    .eq('id', id)
    .select('*')
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(data);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const r = await requireAdmin();
  if (r.kind === 'unauth') {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  if (r.kind === 'forbidden') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const url = new URL(req.url);
  const deleteImported = url.searchParams.get('delete_imported') === 'true';

  const supabase = await createClient();
  let deletedEvents = 0;
  if (deleteImported) {
    // Hard-delete imported events tied to this feed (admin-confirmed).
    // schedule_event_reminders.event_id is ON DELETE CASCADE so the
    // reminder rows get cleaned up automatically.
    const { data: removed, error: rmErr } = await supabase
      .from('schedule_events')
      .delete()
      .eq('external_calendar_id', id)
      .select('id');
    if (rmErr) {
      return NextResponse.json({ error: rmErr.message }, { status: 500 });
    }
    deletedEvents = removed?.length ?? 0;
  }
  // The FK on schedule_events.external_calendar_id is ON DELETE SET NULL,
  // so any remaining imported events become orphaned (external_source +
  // external_id stay; external_calendar_id nulls). The trigger keeps them
  // read-only.
  const { error } = await supabase
    .from('schedule_external_calendars')
    .delete()
    .eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await logEvent({
    source: 'web_server',
    level: 'info',
    category: 'schedule_ext_cal_delete',
    message: 'external calendar deleted',
    context: {
      id,
      delete_imported: deleteImported,
      deleted_events: deletedEvents,
    },
    userId: r.user.id,
  });
  return NextResponse.json({ ok: true, deleted_events: deletedEvents });
}
