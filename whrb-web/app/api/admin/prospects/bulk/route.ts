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

// Stage 10c: cap on the preview.ids list + the ids-apply body length.
const MAX_IDS = 5000;
// Stage 10c: supported page sizes for the paginated preview table.
const PAGE_SIZES = [25, 50, 100, 250] as const;

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
const ActionPayload = z.union([AssignPayload, StatePayload, TierPayload, DeletePayload]);

// Stage 10c: preview body is the filter + optional page / pageSize selector.
const PreviewBody = z.intersection(
  z.object({
    filter: Filter,
    preview: z.literal(true),
    page: z.number().int().min(0).max(1000).optional(),
    pageSize: z
      .number()
      .int()
      .refine((v) => (PAGE_SIZES as readonly number[]).includes(v), {
        message: `pageSize must be one of ${PAGE_SIZES.join(', ')}`,
      })
      .optional(),
  }),
  ActionPayload,
);

// Stage 10b body: apply against the filter's full match set.
const FilterApplyBody = z.intersection(
  z.object({ filter: Filter, preview: z.literal(false).optional() }),
  ActionPayload,
);

// Stage 10c body: apply against an explicit ids list (bypasses filter).
const IdsApplyBody = z.intersection(
  z.object({
    ids: z
      .array(z.string().uuid())
      .min(1)
      .max(MAX_IDS),
    filter: Filter.optional(),
    preview: z.literal(false).optional(),
  }),
  ActionPayload,
);

const Body = z.union([PreviewBody, IdsApplyBody, FilterApplyBody]);
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

type MatchedRow = {
  id: string;
  assigned_to: string | null;
  company_name: string;
  tier: string | null;
  state: string;
};

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

  const isPreview = 'preview' in body && body.preview === true;
  const service = createServiceClient();

  // ---------------- Preview branch (Stage 10c paginated) ----------------
  if (isPreview) {
    const pageSize = body.pageSize ?? 25;
    const page = body.page ?? 0;
    const from = page * pageSize;
    const to = from + pageSize - 1;

    // Full id+count query — capped at MAX_IDS. Using id-only for the cap
    // scan keeps memory bounded even if a filter matches millions.
    const { data: idsData, count, error: idsErr } = await applyFilter(
      service.from('prospects').select('id', { count: 'exact' }),
      body.filter,
    ).range(0, MAX_IDS - 1);
    if (idsErr) {
      return NextResponse.json({ error: idsErr.message }, { status: 500 });
    }
    const totalCount = count ?? (idsData ?? []).length;
    const ids = ((idsData ?? []) as Array<{ id: string }>).map((r) => r.id);
    const countExceeded = totalCount > MAX_IDS;

    // Page slice with richer columns for the table render.
    const { data: rows, error: rowsErr } = await applyFilter(
      service.from('prospects').select('id,assigned_to,company_name,tier,state'),
      body.filter,
    )
      .order('company_name', { ascending: true })
      .range(from, to);
    if (rowsErr) {
      return NextResponse.json({ error: rowsErr.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      count: totalCount,
      ids,
      rows: (rows ?? []) as MatchedRow[],
      page,
      pageSize,
      countExceeded,
      // kept for backward compatibility with any Stage 10b probe; new UI
      // reads `rows` directly.
      sample: ((rows ?? []) as MatchedRow[]).slice(0, 10),
    });
  }

  // ---------------- Apply branches ----------------
  let ids: string[];
  let matchedRows: MatchedRow[];

  if ('ids' in body && body.ids) {
    // Stage 10c selection-basket apply. Fetch notif context rows by ids.
    ids = body.ids;
    const { data: fetched, error: fErr } = await service
      .from('prospects')
      .select('id,assigned_to,company_name,tier,state')
      .in('id', ids);
    if (fErr) {
      await logEvent({
        source: 'web_server',
        level: 'error',
        category: 'api_exception',
        message: 'bulk ids-apply fetch failed',
        context: { code: fErr.code, message: fErr.message, ids_count: ids.length },
        userId: authz.user.id,
      });
      return NextResponse.json({ error: fErr.message }, { status: 500 });
    }
    matchedRows = (fetched ?? []) as MatchedRow[];
    // Drop any ids that no longer exist (e.g. deleted between preview + apply).
    const existing = new Set(matchedRows.map((r) => r.id));
    ids = ids.filter((x) => existing.has(x));
  } else {
    // Stage 10b filter-based apply. Fetch all matched rows up to MAX_IDS.
    // `body.filter` is required on FilterApplyBody but TS's union narrowing
    // after the `'ids' in body` check can still see an optional — fall back
    // to an empty filter which applyFilter handles as a no-op.
    const filterForApply = body.filter ?? {};
    const { data: matched, count, error: selErr } = await applyFilter(
      service.from('prospects').select('id,assigned_to,company_name,tier,state', { count: 'exact' }),
      filterForApply,
    ).range(0, MAX_IDS - 1);
    if (selErr) {
      await logEvent({
        source: 'web_server',
        level: 'error',
        category: 'api_exception',
        message: 'bulk preview select failed',
        context: { code: selErr.code, message: selErr.message, filter: filterForApply },
        userId: authz.user.id,
      });
      return NextResponse.json({ error: selErr.message }, { status: 500 });
    }
    matchedRows = (matched ?? []) as MatchedRow[];
    if ((count ?? matchedRows.length) > MAX_IDS) {
      return NextResponse.json(
        {
          error: `Filter matches ${count ?? matchedRows.length} rows — exceeds ${MAX_IDS} cap. Narrow the filter or switch to selection mode.`,
        },
        { status: 400 },
      );
    }
    ids = matchedRows.map((r) => r.id);
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
    const fanouts: Array<() => Promise<unknown>> = [];
    for (const row of matchedRows) {
      if (!ids.includes(row.id)) continue;
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

  const via = 'ids' in body && body.ids ? 'ids' : 'filter';
  await logEvent({
    source: 'web_server',
    level: 'info',
    category: 'bulk_action',
    message: `bulk ${body.action} on ${ids.length} prospects`,
    context: {
      action: body.action,
      filter: 'filter' in body ? body.filter : null,
      count: ids.length,
      ids,
      payload: body.payload,
      via,
    },
    userId: authz.user.id,
  });

  return NextResponse.json({ ok: true, count: ids.length, action: body.action, via });
}
