import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getAuthed } from '@/lib/server/authz';
import { logEvent } from '@/lib/logging/server';
import { rowsToCsv, rowsToXlsxBuffer, type ExportColumn } from '@/lib/server/export';
import { checkRate } from '@/lib/server/ratelimit';

export const runtime = 'nodejs';

const COLUMNS: ExportColumn[] = [
  { key: 'created_at', header: 'Created', kind: 'date' },
  { key: 'level', header: 'Level' },
  { key: 'source', header: 'Source' },
  { key: 'category', header: 'Category' },
  { key: 'message', header: 'Message' },
  { key: 'user_id', header: 'User' },
  { key: 'pipeline_run_id', header: 'Pipeline run' },
  { key: 'http_status', header: 'HTTP', kind: 'number' },
  { key: 'url', header: 'URL' },
  { key: 'context', header: 'Context' },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyLogFilter(qb: any, sp: URLSearchParams): any {
  let q = qb;
  const level = sp.get('level');
  const category = sp.get('category');
  const source = sp.get('source');
  const since = sp.get('since');
  const until = sp.get('until');
  const search = sp.get('q');
  if (level) q = q.eq('level', level);
  if (category) q = q.eq('category', category);
  if (source) q = q.eq('source', source);
  if (since) q = q.gte('created_at', since);
  if (until) q = q.lte('created_at', until);
  if (search && search.trim()) {
    q = q.ilike('message', `%${search.trim()}%`);
  }
  return q;
}

export async function GET(req: Request) {
  const authz = await getAuthed();
  if (authz.kind === 'unauth') {
    return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });
  }
  if (authz.user.role !== 'admin') {
    return NextResponse.json({ error: 'Admin role required.' }, { status: 403 });
  }

  const url = new URL(req.url);
  const format = (url.searchParams.get('format') || 'csv').toLowerCase();
  if (format !== 'csv' && format !== 'xlsx') {
    return NextResponse.json({ error: 'format must be csv or xlsx.' }, { status: 400 });
  }

  const rate = await checkRate({
    prefix: 'export:logs',
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

  const supabase = await createClient();
  let q = supabase
    .from('event_log')
    .select('id,created_at,level,source,category,message,user_id,pipeline_run_id,http_status,url,context')
    .order('created_at', { ascending: false })
    .limit(10_000);
  q = applyLogFilter(q, url.searchParams);
  const { data, error } = await q;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const rows = data ?? [];

  await logEvent({
    source: 'web_server',
    level: 'info',
    category: 'export',
    message: `event_log export (${format})`,
    context: {
      format,
      rows: rows.length,
      filter: Object.fromEntries(url.searchParams.entries()),
    },
    userId: authz.user.id,
  });

  if (format === 'csv') {
    const csv = rowsToCsv(rows, COLUMNS);
    const filename = `whrb-event-log-${new Date().toISOString().slice(0, 10)}.csv`;
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  }
  const buffer = await rowsToXlsxBuffer(rows, COLUMNS, { sheetName: 'EventLog' });
  const filename = `whrb-event-log-${new Date().toISOString().slice(0, 10)}.xlsx`;
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
