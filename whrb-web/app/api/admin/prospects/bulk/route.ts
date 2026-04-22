import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { getAuthed } from '@/lib/server/authz';
import { logEvent } from '@/lib/logging/server';
import { notify } from '@/lib/server/notifications';

export const runtime = 'nodejs';

const STATE_VALUES = [
  'researching',
  'waiting_response',
  'initial_contact',
  'ongoing_contact',
  'sold',
  'previous_client',
  'dead',
] as const;

const Filter = z.object({
  q: z.string().optional(),
  tier: z.string().optional(),
  state: z.string().optional(),
  assigned_to: z.string().uuid().optional(),
  zip: z.string().optional(),
  category: z.string().optional(),
  source: z.string().optional(),
  is_nonprofit: z.enum(['true', 'false']).optional(),
  assigned: z.enum(['true', 'false']).optional(),
});

const AssignPayload = z.object({
  action: z.literal('assign'),
  payload: z.object({ assigned_to: z.string().uuid().nullable() }),
});
const StatePayload = z.object({
  action: z.literal('state'),
  payload: z.object({ state: z.enum(STATE_VALUES) }),
});
const TierPayload = z.object({
  action: z.literal('tier'),
  payload: z.object({ tier: z.enum(['A', 'B', 'C']) }),
});
const DeletePayload = z.object({
  action: z.literal('delete'),
  payload: z.object({ confirm: z.literal('DELETE') }),
});

const Body = z.intersection(
  z.object({ filter: Filter, preview: z.boolean().optional() }),
  z.union([AssignPayload, StatePayload, TierPayload, DeletePayload]),
);

type ParsedBody = z.infer<typeof Body>;

const SEARCH_FIELDS = [
  'company_name',
  'contact_name',
  'company_email',
  'contact_email',
  'company_phone',
  'contact_phone',
  'website',
  'category',
  'source',
];

// The type narrowing of the PostgREST query builder chain across conditional
// `.eq/.or/.ilike/.not/.is` calls is hostile to TS inference; treat the
// incoming filter builder as `any` at the helper boundary. Each specific
// method call still goes through supabase-js's runtime validation.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyFilter(qb: any, filter: z.infer<typeof Filter>): any {
  let q = qb;
  if (filter.q && filter.q.trim()) {
    const term = filter.q.trim().replace(/[%_]/g, '');
    const orClause = SEARCH_FIELDS.map((f) => `${f}.ilike.%${term}%`).join(',');
    q = q.or(orClause);
  }
  if (filter.tier) q = q.eq('tier', filter.tier);
  if (filter.state) q = q.eq('state', filter.state);
  if (filter.assigned_to) q = q.eq('assigned_to', filter.assigned_to);
  if (filter.zip) q = q.eq('zip', filter.zip);
  if (filter.category) q = q.ilike('category', `%${filter.category}%`);
  if (filter.source) q = q.eq('source', filter.source);
  if (filter.is_nonprofit === 'true') q = q.eq('is_nonprofit', true);
  if (filter.is_nonprofit === 'false') q = q.not('is_nonprofit', 'is', true);
  if (filter.assigned === 'false') q = q.is('assigned_to', null);
  if (filter.assigned === 'true') q = q.not('assigned_to', 'is', null);
  return q;
}

export async function POST(req: Request) {
  const authz = await getAuthed();
  if (authz.kind === 'unauth') {
    return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });
  }
  if (authz.user.role !== 'admin') {
    return NextResponse.json({ error: 'Admin role required.' }, { status: 403 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json(
      { error: `Invalid payload: ${issue.path.join('.') || '<root>'} — ${issue.message}` },
      { status: 400 },
    );
  }
  const body: ParsedBody = parsed.data;

  const preview = 'preview' in body && body.preview === true;
  const service = createServiceClient();

  const selectQ = applyFilter(
    service.from('prospects').select('id,assigned_to,company_name,tier,state', { count: 'exact' }),
    body.filter,
  );
  const { data: matched, count, error: selErr } = await selectQ;
  if (selErr) {
    await logEvent({
      source: 'web_server',
      level: 'error',
      category: 'api_exception',
      message: 'bulk preview select failed',
      context: { code: selErr.code, message: selErr.message, filter: body.filter },
      userId: authz.user.id,
    });
    return NextResponse.json({ error: selErr.message }, { status: 500 });
  }
  const matchedRows = (matched ?? []) as Array<{
    id: string;
    assigned_to: string | null;
    company_name: string;
    tier: string | null;
    state: string;
  }>;
  const totalCount = count ?? matchedRows.length;
  const ids = matchedRows.map((r) => r.id);

  if (preview) {
    return NextResponse.json({
      ok: true,
      count: totalCount,
      sample: matchedRows.slice(0, 10),
    });
  }

  if (ids.length === 0) {
    return NextResponse.json({ ok: true, count: 0, action: body.action });
  }

  const supabase = await createClient();

  // Dispatch per action
  if (body.action === 'assign') {
    const newAssignee = body.payload.assigned_to;
    const { error } = await supabase
      .from('prospects')
      .update({
        assigned_to: newAssignee,
        assigned_at: newAssignee ? new Date().toISOString() : null,
      })
      .in('id', ids);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    // Fan out notifications. To avoid spam: group by recipient and insert one row per (recipient, prospect).
    const fanouts: Array<() => Promise<unknown>> = [];
    for (const row of matchedRows) {
      if (newAssignee && newAssignee !== row.assigned_to) {
        fanouts.push(() =>
          notify({
            recipientId: newAssignee,
            kind: 'assigned',
            actorId: authz.user.id,
            prospectId: row.id,
            payload: {
              prospect_id: row.id,
              prospect_name: row.company_name,
              actor_id: authz.user.id,
              previous_assignee: row.assigned_to,
              via: 'bulk_assign',
            },
          }),
        );
      }
      if (
        row.assigned_to &&
        row.assigned_to !== newAssignee &&
        row.assigned_to !== authz.user.id
      ) {
        fanouts.push(() =>
          notify({
            recipientId: row.assigned_to as string,
            kind: 'unassigned',
            actorId: authz.user.id,
            prospectId: row.id,
            payload: {
              prospect_id: row.id,
              prospect_name: row.company_name,
              actor_id: authz.user.id,
              new_assignee: newAssignee,
              via: 'bulk_assign',
            },
          }),
        );
      }
    }
    await Promise.all(fanouts.map((f) => f()));
  } else if (body.action === 'state') {
    const { error } = await supabase
      .from('prospects')
      .update({ state: body.payload.state })
      .in('id', ids);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else if (body.action === 'tier') {
    const { error } = await supabase
      .from('prospects')
      .update({ tier: body.payload.tier })
      .in('id', ids);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else if (body.action === 'delete') {
    const { error } = await service.from('prospects').delete().in('id', ids);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await logEvent({
    source: 'web_server',
    level: 'info',
    category: 'bulk_action',
    message: `bulk ${body.action} on ${ids.length} prospects`,
    context: {
      action: body.action,
      filter: body.filter,
      count: ids.length,
      ids,
      payload: body.payload,
    },
    userId: authz.user.id,
  });

  return NextResponse.json({ ok: true, count: ids.length, action: body.action });
}
