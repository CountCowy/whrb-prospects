import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { getAuthed } from '@/lib/server/authz';
import { logEvent } from '@/lib/logging/server';
import { rowsToCsv, rowsToXlsxBuffer, type ExportColumn } from '@/lib/server/export';
import { checkRate } from '@/lib/server/ratelimit';

export const runtime = 'nodejs';

// Tag axes mirror whrb-prospects/pipeline.py::TAG_AXES_FOR_CSV. Order is
// load-bearing for deterministic column ordering across the pipeline CSV
// and this web export. `daypart_fit` is computed-on-read via the
// `prospect_daypart` view (T2 migration 008); the rest come from
// prospect_tags joined to tag_vocabulary.
const TAG_AXES = [
  'sector',
  'operating_model',
  'genre',
  'affiliation',
  'cadence',
  'daypart_fit',
  'history',
  'compliance',
  'other',
] as const;
type TagAxis = (typeof TAG_AXES)[number];

const DEFAULT_COLUMNS: ExportColumn[] = [
  { key: 'company_name', header: 'Company' },
  { key: 'tier', header: 'Tier' },
  { key: 'state', header: 'State' },
  { key: 'contact_name', header: 'Contact name' },
  { key: 'contact_email', header: 'Contact email' },
  { key: 'contact_phone', header: 'Contact phone' },
  { key: 'company_email', header: 'Company email' },
  { key: 'company_phone', header: 'Company phone' },
  { key: 'website', header: 'Website' },
  { key: 'category', header: 'Category' },
  { key: 'source', header: 'Source' },
  { key: 'zip', header: 'ZIP' },
  { key: 'address', header: 'Address' },
  { key: 'priority_score', header: 'Priority', kind: 'number' },
  { key: 'is_nonprofit', header: 'Nonprofit', kind: 'boolean' },
  { key: 'ein', header: 'EIN' },
  { key: 'nonprofit_source', header: 'Nonprofit source' },
  { key: 'rating', header: 'Rating', kind: 'number' },
  { key: 'review_count', header: 'Reviews', kind: 'number' },
  { key: 'assigned_to', header: 'Assigned to' },
  { key: 'pipeline_last_seen_at', header: 'Pipeline last seen', kind: 'date' },
  { key: 'created_at', header: 'Created', kind: 'date' },
  ...TAG_AXES.map<ExportColumn>((axis) => ({
    key: `tags_${axis}`,
    header: `Tags: ${axis}`,
  })),
];

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
function applyFilter(qb: any, sp: URLSearchParams): any {
  let q = qb;
  const get = (k: string) => sp.get(k) ?? undefined;
  const qTerm = get('q');
  if (qTerm && qTerm.trim()) {
    const term = qTerm.trim().replace(/[%_]/g, '');
    const or = SEARCH_FIELDS.map((f) => `${f}.ilike.%${term}%`).join(',');
    q = q.or(or);
  }
  if (get('tier')) q = q.eq('tier', get('tier'));
  if (get('state')) q = q.eq('state', get('state'));
  if (get('assigned_to')) q = q.eq('assigned_to', get('assigned_to'));
  if (get('zip')) q = q.eq('zip', get('zip'));
  if (get('category')) q = q.ilike('category', `%${get('category')}%`);
  if (get('source')) q = q.eq('source', get('source'));
  if (get('is_nonprofit') === 'true') q = q.eq('is_nonprofit', true);
  if (get('is_nonprofit') === 'false') q = q.not('is_nonprofit', 'is', true);
  if (get('assigned') === 'false') q = q.is('assigned_to', null);
  if (get('assigned') === 'true') q = q.not('assigned_to', 'is', null);
  if (get('mine') === '1' && get('userId')) q = q.eq('assigned_to', get('userId'));
  return q;
}

export async function GET(req: Request) {
  const authz = await getAuthed();
  if (authz.kind === 'unauth') {
    return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });
  }

  const url = new URL(req.url);
  const format = (url.searchParams.get('format') || 'csv').toLowerCase();
  if (format !== 'csv' && format !== 'xlsx') {
    return NextResponse.json({ error: 'format must be csv or xlsx.' }, { status: 400 });
  }

  const rate = await checkRate({
    prefix: 'export:prospects',
    identifier: authz.user.id,
    limit: 1,
    windowSeconds: 60,
  });
  if (!rate.success) {
    const waitSec = Math.max(1, Math.ceil((rate.reset - Date.now()) / 1000));
    return NextResponse.json(
      { error: `Rate limit: 1 export per minute. Try again in ${waitSec}s.` },
      { status: 429, headers: { 'Retry-After': String(waitSec) } },
    );
  }

  // If the caller asked for "mine" we need the user's own id; the query
  // handler substitutes auth.uid() on the SELECT path, but for export we
  // pass it explicitly so the filter helper sees a concrete uuid.
  const qp = new URLSearchParams(url.search);
  if (qp.get('mine') === '1') qp.set('userId', authz.user.id);

  const supabase = await createClient();
  let q = supabase
    .from('prospects')
    .select(
      'id,company_name,tier,state,contact_name,contact_email,contact_phone,company_email,company_phone,website,category,source,zip,address,priority_score,is_nonprofit,ein,nonprofit_source,rating,review_count,assigned_to,pipeline_last_seen_at,created_at',
    )
    .order('priority_score', { ascending: false, nullsFirst: false })
    .order('id', { ascending: true })
    .limit(10_000);
  q = applyFilter(q, qp);
  const { data, error } = await q;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const rows = data ?? [];

  // Swap assigned_to UUIDs for email labels in the export only.
  const assignedIds = [...new Set(rows.map((r) => r.assigned_to).filter(Boolean) as string[])];
  const labels = new Map<string, string>();
  if (assignedIds.length > 0) {
    const service = createServiceClient();
    const { data: profs } = await service
      .from('profiles')
      .select('id,email,display_name')
      .in('id', assignedIds);
    for (const p of profs ?? []) {
      labels.set(
        p.id as string,
        (p.display_name as string | null)?.trim() || (p.email as string),
      );
    }
  }

  // Fetch tag data for the prospect set so the export carries per-axis
  // tag columns (T2 plan §4.4). Suppressed compliance rows (per §1.3
  // #24) are filtered out — the export reflects what the rep sees.
  // Daypart values come from the computed `prospect_daypart` view; the
  // other 8 axes come from prospect_tags joined to tag_vocabulary.
  const prospectIds = rows.map((r) => r.id as string);
  const tagsByProspect = new Map<string, Record<TagAxis, Set<string>>>();
  const initBag = (): Record<TagAxis, Set<string>> =>
    Object.fromEntries(TAG_AXES.map((a) => [a, new Set<string>()])) as Record<
      TagAxis,
      Set<string>
    >;
  if (prospectIds.length > 0) {
    const { data: tagRows, error: tagErr } = await supabase
      .from('prospect_tags')
      .select('prospect_id, tag_vocabulary!inner(axis, value)')
      .in('prospect_id', prospectIds)
      .is('suppressed_at', null);
    if (tagErr) {
      return NextResponse.json({ error: tagErr.message }, { status: 500 });
    }
    for (const row of tagRows ?? []) {
      // The PostgREST embed returns tag_vocabulary as an object on a
      // unique FK; under some join modes it surfaces as a single-element
      // array. Coerce to the object shape.
      const vocab = Array.isArray(row.tag_vocabulary)
        ? row.tag_vocabulary[0]
        : row.tag_vocabulary;
      if (!vocab) continue;
      const axis = vocab.axis as TagAxis | undefined;
      const value = vocab.value as string | undefined;
      if (!axis || !value || !TAG_AXES.includes(axis)) continue;
      const pid = row.prospect_id as string;
      if (!tagsByProspect.has(pid)) tagsByProspect.set(pid, initBag());
      tagsByProspect.get(pid)![axis].add(value);
    }
    const { data: dayparts, error: dpErr } = await supabase
      .from('prospect_daypart')
      .select('prospect_id, daypart_fit')
      .in('prospect_id', prospectIds);
    if (dpErr) {
      return NextResponse.json({ error: dpErr.message }, { status: 500 });
    }
    for (const row of dayparts ?? []) {
      const pid = row.prospect_id as string;
      const values = (row.daypart_fit ?? []) as string[];
      if (values.length === 0) continue;
      if (!tagsByProspect.has(pid)) tagsByProspect.set(pid, initBag());
      const bag = tagsByProspect.get(pid)!;
      for (const v of values) bag.daypart_fit.add(v);
    }
  }

  const decorated = rows.map((r) => {
    const bag = tagsByProspect.get(r.id as string);
    const tagCols: Record<string, string> = {};
    for (const axis of TAG_AXES) {
      const set = bag?.[axis];
      tagCols[`tags_${axis}`] = set ? [...set].sort().join(',') : '';
    }
    return {
      ...r,
      ...tagCols,
      assigned_to: r.assigned_to ? labels.get(r.assigned_to as string) ?? r.assigned_to : null,
    };
  });

  await logEvent({
    source: 'web_server',
    level: 'info',
    category: 'export',
    message: `prospects export (${format})`,
    context: {
      format,
      rows: rows.length,
      filter: Object.fromEntries(url.searchParams.entries()),
    },
    userId: authz.user.id,
  });

  if (format === 'csv') {
    const csv = rowsToCsv(decorated, DEFAULT_COLUMNS);
    const filename = `whrb-prospects-${new Date().toISOString().slice(0, 10)}.csv`;
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  }

  const buffer = await rowsToXlsxBuffer(decorated, DEFAULT_COLUMNS, {
    sheetName: 'Prospects',
  });
  const filename = `whrb-prospects-${new Date().toISOString().slice(0, 10)}.xlsx`;
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
