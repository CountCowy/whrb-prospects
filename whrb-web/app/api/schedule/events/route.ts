import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { randomUUID } from 'crypto';

import { createClient } from '@/lib/supabase/server';
import { getAuthed } from '@/lib/server/authz';
import { logEvent } from '@/lib/logging/server';
import { generateRecurrenceUtc } from '@/lib/schedule-recurrence';
import { materializeRemindersForEvent } from '@/lib/server/schedule-reminders';
import { SCHEDULE_CATEGORIES } from '@/styles/schedule-colors';

export const runtime = 'nodejs';

const RecurrenceBody = z.object({
  pattern: z.enum(['daily', 'weekly']),
  weekdays: z.array(z.number().int().min(0).max(6)).optional(),
  interval: z.number().int().min(1).max(52).optional(),
  count: z.number().int().min(1).max(100).optional(),
  // Accept either a full ISO datetime or a date-only YYYY-MM-DD. The
  // recurrence generator interprets date-only as 23:59:59 ET (inclusive).
  until: z
    .string()
    .refine(
      (s) =>
        /^\d{4}-\d{2}-\d{2}$/.test(s) ||
        !Number.isNaN(Date.parse(s)),
      { message: 'until must be ISO datetime or YYYY-MM-DD' },
    )
    .optional(),
});

const EventBody = z
  .object({
    title: z.string().min(1).max(200),
    description: z.string().max(5000).optional().nullable(),
    category: z.enum(SCHEDULE_CATEGORIES as unknown as [string, ...string[]]),
    starts_at: z.string().datetime(),
    duration_minutes: z.number().int().min(1).max(1440).optional(),
    all_day: z.boolean().optional(),
    assignee_kind: z.enum(['user', 'team_wide', 'admin']),
    assigned_to: z.string().uuid().optional().nullable(),
    prospect_id: z.string().uuid().optional().nullable(),
    location: z.string().max(300).optional().nullable(),
    url: z.string().max(1000).optional().nullable(),
    visibility: z.enum(['public', 'private']).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    recurrence: RecurrenceBody.optional(),
  })
  .superRefine((val, ctx) => {
    if (val.assignee_kind === 'user' && !val.assigned_to) {
      ctx.addIssue({
        code: 'custom',
        message: 'assigned_to is required when assignee_kind=user',
        path: ['assigned_to'],
      });
    }
    if (val.assignee_kind !== 'user' && val.assigned_to) {
      ctx.addIssue({
        code: 'custom',
        message: 'assigned_to must be null for team_wide/admin',
        path: ['assigned_to'],
      });
    }
    if (val.visibility === 'private' && val.assignee_kind !== 'user') {
      ctx.addIssue({
        code: 'custom',
        message: 'private events must have assignee_kind=user',
        path: ['visibility'],
      });
    }
  });

// Largest from/to window the GET endpoint will accept. The `/schedule`
// month grid asks for ~6 weeks; the agenda for ~30 days; "Upcoming for
// you" for 14. 100 days is comfortably above all of those and prevents
// `from=1970&to=9999` triple-join scans.
const MAX_RANGE_MS = 100 * 86_400_000;

export async function GET(req: NextRequest) {
  const authz = await getAuthed();
  if (authz.kind === 'unauth') {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const url = new URL(req.url);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  if (!from || !to) {
    return NextResponse.json({ error: 'from and to required' }, { status: 400 });
  }
  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);
  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) {
    return NextResponse.json(
      { error: 'from and to must be ISO timestamps' },
      { status: 400 },
    );
  }
  if (toMs <= fromMs) {
    return NextResponse.json(
      { error: 'to must be after from' },
      { status: 400 },
    );
  }
  if (toMs - fromMs > MAX_RANGE_MS) {
    return NextResponse.json(
      { error: 'window too large (max 100 days)' },
      { status: 400 },
    );
  }
  const supabase = await createClient();
  let query = supabase
    .from('schedule_events')
    .select(
      '*, ' +
        'author:profiles!author_id(id,email,display_name), ' +
        'assignee:profiles!assigned_to(id,email,display_name), ' +
        'prospect:prospects!prospect_id(id,company_name)',
    )
    .gte('starts_at', from)
    .lt('starts_at', to)
    .order('starts_at', { ascending: true })
    .limit(500);

  const category = url.searchParams.getAll('category');
  if (category.length > 0) query = query.in('category', category);
  const assignee = url.searchParams.get('assignee_kind');
  if (assignee) query = query.eq('assignee_kind', assignee);
  const prospectId = url.searchParams.get('prospect_id');
  if (prospectId) query = query.eq('prospect_id', prospectId);
  const scope = url.searchParams.get('scope');
  if (scope === 'mine') {
    query = query.or(`author_id.eq.${authz.user.id},assigned_to.eq.${authz.user.id}`);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ items: data ?? [] });
}

export async function POST(req: NextRequest) {
  const authz = await getAuthed();
  if (authz.kind === 'unauth') {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const json = await req.json().catch(() => null);
  const parsed = EventBody.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json(
      { error: `invalid: ${issue.path.join('.')} — ${issue.message}` },
      { status: 400 },
    );
  }
  const body = parsed.data;
  const supabase = await createClient();

  const baseRow = {
    title: body.title,
    description: body.description ?? null,
    category: body.category,
    starts_at: body.starts_at,
    duration_minutes: body.duration_minutes ?? 30,
    all_day: body.all_day ?? false,
    assignee_kind: body.assignee_kind,
    assigned_to: body.assigned_to ?? null,
    author_id: authz.user.id,
    prospect_id: body.prospect_id ?? null,
    location: body.location ?? null,
    url: body.url ?? null,
    visibility: body.visibility ?? 'public',
    metadata: body.metadata ?? {},
  };

  let rows: Array<typeof baseRow & { series_id: string | null }>;
  if (body.recurrence) {
    const occurrences = generateRecurrenceUtc(body.starts_at, body.recurrence);
    if (occurrences.length === 0) {
      return NextResponse.json(
        { error: 'recurrence produced 0 occurrences' },
        { status: 400 },
      );
    }
    const seriesId = randomUUID();
    rows = occurrences.map((utc) => ({
      ...baseRow,
      starts_at: utc.toISOString(),
      series_id: seriesId,
    }));
  } else {
    rows = [{ ...baseRow, series_id: null }];
  }

  const { data, error } = await supabase
    .from('schedule_events')
    .insert(rows)
    .select('id, series_id');
  if (error) {
    await logEvent({
      source: 'web_server',
      level: 'error',
      category: 'schedule_event_create_failed',
      message: 'schedule_events insert failed',
      context: { code: error.code, message: error.message },
      userId: authz.user.id,
    });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const inserted = (data ?? []) as Array<{ id: string; series_id: string | null }>;

  await Promise.all(inserted.map((row) => materializeRemindersForEvent(row.id)));

  await logEvent({
    source: 'web_server',
    level: 'info',
    category: 'schedule_event_create',
    message: `created ${inserted.length} schedule event(s)`,
    context: {
      ids: inserted.map((r) => r.id),
      series_id: inserted[0]?.series_id ?? null,
      category: body.category,
      assignee_kind: body.assignee_kind,
    },
    userId: authz.user.id,
  });

  return NextResponse.json(
    {
      ids: inserted.map((r) => r.id),
      series_id: inserted[0]?.series_id ?? null,
    },
    { status: 201 },
  );
}
