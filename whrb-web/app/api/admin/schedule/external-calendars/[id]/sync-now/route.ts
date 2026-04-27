import { NextResponse, type NextRequest } from 'next/server';

import { createClient } from '@/lib/supabase/server';
import { getAuthed } from '@/lib/server/authz';
import { logEvent } from '@/lib/logging/server';

export const runtime = 'nodejs';

/**
 * Marks the given feed as `last_status='running'` and dispatches the
 * external-calendar-sync GitHub Actions workflow. The actual sync is
 * performed by `whrb-prospects/scripts/sync_external_calendars.py`.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const authz = await getAuthed();
  if (authz.kind === 'unauth') {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  if (authz.user.role !== 'admin') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('schedule_external_calendars')
    .update({ last_status: 'running' })
    .eq('id', id)
    .select('id, name, feed_url')
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const pat = process.env.GH_DISPATCH_PAT;
  const owner = process.env.GH_OWNER ?? 'CountCowy';
  const repo = process.env.GH_REPO ?? 'whrb-prospects';
  if (!pat) {
    await logEvent({
      source: 'web_server',
      level: 'warn',
      category: 'schedule_ext_cal_sync_dispatch_skipped',
      message: 'GH_DISPATCH_PAT not set; sync_now noop',
      context: { calendar_id: id },
      userId: authz.user.id,
    });
    return NextResponse.json(
      { ok: false, error: 'sync dispatch unavailable' },
      { status: 503 },
    );
  }

  const dispatchRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/dispatches`,
    {
      method: 'POST',
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${pat}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({
        event_type: 'sync_external_calendar',
        client_payload: { calendar_id: id },
      }),
    },
  );
  if (!dispatchRes.ok) {
    return NextResponse.json(
      { error: `github dispatch failed (${dispatchRes.status})` },
      { status: 502 },
    );
  }
  return NextResponse.json({ ok: true });
}
