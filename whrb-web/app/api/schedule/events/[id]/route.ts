import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { createClient } from '@/lib/supabase/server';
import { getAuthed } from '@/lib/server/authz';
import { logEvent } from '@/lib/logging/server';
import {
  clearPendingReminders,
  materializeRemindersForEvent,
} from '@/lib/server/schedule-reminders';
import { SCHEDULE_CATEGORIES } from '@/styles/schedule-colors';

export const runtime = 'nodejs';

const PatchBody = z
  .object({
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(5000).nullable().optional(),
    category: z
      .enum(SCHEDULE_CATEGORIES as unknown as [string, ...string[]])
      .optional(),
    starts_at: z.string().datetime().optional(),
    duration_minutes: z.number().int().min(1).max(1440).optional(),
    all_day: z.boolean().optional(),
    assignee_kind: z.enum(['user', 'team_wide', 'admin']).optional(),
    assigned_to: z.string().uuid().nullable().optional(),
    prospect_id: z.string().uuid().nullable().optional(),
    location: z.string().max(300).nullable().optional(),
    url: z.string().max(1000).nullable().optional(),
    visibility: z.enum(['public', 'private']).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    apply_to_series: z.boolean().optional(),
  })
  .strict();

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
    .from('schedule_events')
    .select(
      '*, ' +
        'author:profiles!author_id(id,email,display_name), ' +
        'assignee:profiles!assigned_to(id,email,display_name), ' +
        'prospect:prospects!prospect_id(id,company_name)',
    )
    .eq('id', id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(data);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const authz = await getAuthed();
  if (authz.kind === 'unauth') {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
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
  const { apply_to_series, ...patch } = parsed.data;

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from('schedule_events')
    .select('id, series_id, author_id, assigned_to, assignee_kind, external_source')
    .eq('id', id)
    .maybeSingle();
  if (!existing) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  if (existing.external_source) {
    return NextResponse.json(
      { error: 'imported_event_read_only' },
      { status: 403 },
    );
  }

  // Visibility implies user-kind constraint; reject illegal combos before the DB.
  const nextKind = patch.assignee_kind ?? existing.assignee_kind;
  const nextVis = patch.visibility ?? null;
  if (nextVis === 'private' && nextKind !== 'user') {
    return NextResponse.json(
      { error: 'private events must have assignee_kind=user' },
      { status: 400 },
    );
  }

  const writePatch: Record<string, unknown> = { ...patch };
  if ('assigned_to' in writePatch && writePatch.assigned_to === undefined) {
    delete writePatch.assigned_to;
  }

  let updated: Array<{ id: string }> = [];
  if (apply_to_series && existing.series_id) {
    const { data, error } = await supabase
      .from('schedule_events')
      .update(writePatch)
      .eq('series_id', existing.series_id)
      .gte('starts_at', new Date().toISOString())
      .select('id');
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    updated = (data ?? []) as Array<{ id: string }>;
  } else {
    const { data, error } = await supabase
      .from('schedule_events')
      .update(writePatch)
      .eq('id', id)
      .select('id');
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    updated = (data ?? []) as Array<{ id: string }>;
  }

  // Recipient set may have changed if assignee_kind/assigned_to changed.
  if (patch.assignee_kind || 'assigned_to' in patch) {
    for (const row of updated) {
      await clearPendingReminders(row.id);
      await materializeRemindersForEvent(row.id);
    }
  }

  await logEvent({
    source: 'web_server',
    level: 'info',
    category: 'schedule_event_update',
    message: `updated ${updated.length} schedule event(s)`,
    context: { ids: updated.map((r) => r.id), patch: writePatch },
    userId: authz.user.id,
  });

  return NextResponse.json({ ids: updated.map((r) => r.id) });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const authz = await getAuthed();
  if (authz.kind === 'unauth') {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const url = new URL(req.url);
  const wholeSeries = url.searchParams.get('series') === 'true';

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from('schedule_events')
    .select('id, series_id, author_id, assigned_to, assignee_kind, external_source')
    .eq('id', id)
    .maybeSingle();
  if (!existing) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  if (existing.external_source) {
    return NextResponse.json(
      { error: 'imported_event_read_only' },
      { status: 403 },
    );
  }

  const isAdmin = authz.user.role === 'admin';
  const isAuthor = existing.author_id === authz.user.id;
  const isAssignee =
    existing.assignee_kind === 'user' &&
    existing.assigned_to === authz.user.id;
  if (!isAdmin && !isAuthor && !isAssignee) {
    return NextResponse.json(
      { error: 'only the author, assignee, or an admin may delete this event' },
      { status: 403 },
    );
  }

  let deletedIds: string[];
  if (wholeSeries && existing.series_id) {
    const { data, error } = await supabase
      .from('schedule_events')
      .delete()
      .eq('series_id', existing.series_id)
      .select('id');
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    deletedIds = ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
  } else {
    const { data, error } = await supabase
      .from('schedule_events')
      .delete()
      .eq('id', id)
      .select('id');
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    deletedIds = ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
  }

  await logEvent({
    source: 'web_server',
    level: 'info',
    category: 'schedule_event_delete',
    message: `deleted ${deletedIds.length} schedule event(s)`,
    context: { ids: deletedIds, series: wholeSeries },
    userId: authz.user.id,
  });
  return NextResponse.json({ ids: deletedIds });
}
