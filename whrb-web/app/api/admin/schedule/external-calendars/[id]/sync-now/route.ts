import { NextResponse, type NextRequest } from 'next/server';

import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/server/authz';
import { logEvent } from '@/lib/logging/server';

export const runtime = 'nodejs';

/**
 * Marks the given feed as `last_status='running'` and dispatches the
 * external-calendar-sync GitHub Actions workflow. The actual sync is
 * performed by `whrb-prospects/scripts/sync_external_calendars.py`.
 *
 * If the dispatch fails we MUST revert `last_status` back to whatever it
 * was so the row doesn't get stuck "running" forever.
 */
export async function POST(
  _req: NextRequest,
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
  const supabase = await createClient();

  // Snapshot the prior status so we can revert if dispatch fails.
  const { data: existing } = await supabase
    .from('schedule_external_calendars')
    .select('id, name, feed_url, last_status')
    .eq('id', id)
    .maybeSingle();
  if (!existing) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  const priorStatus =
    (existing.last_status as 'success' | 'failure' | 'running' | null) ?? null;

  await supabase
    .from('schedule_external_calendars')
    .update({ last_status: 'running' })
    .eq('id', id);

  const pat = process.env.GH_DISPATCH_PAT;
  const owner = process.env.GH_OWNER;
  const repo = process.env.GH_REPO;
  if (!pat || !owner || !repo) {
    await revertStatus(supabase, id, priorStatus);
    await logEvent({
      source: 'web_server',
      level: 'warn',
      category: 'schedule_ext_cal_sync_dispatch_skipped',
      message: 'GH_DISPATCH_PAT/GH_OWNER/GH_REPO not configured; sync_now noop',
      context: {
        calendar_id: id,
        actor_id: r.user.id,
        missing: [
          !pat ? 'GH_DISPATCH_PAT' : null,
          !owner ? 'GH_OWNER' : null,
          !repo ? 'GH_REPO' : null,
        ].filter(Boolean),
      },
      userId: r.user.id,
    });
    return NextResponse.json(
      { ok: false, error: 'sync dispatch unavailable' },
      { status: 503 },
    );
  }

  let dispatchRes: Response;
  try {
    dispatchRes = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/dispatches`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${pat}`,
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify({
          event_type: 'sync_external_calendar',
          client_payload: { calendar_id: id, actor_id: r.user.id },
        }),
      },
    );
  } catch (err) {
    await revertStatus(supabase, id, priorStatus);
    await logEvent({
      source: 'web_server',
      level: 'error',
      category: 'schedule_ext_cal_sync_dispatch_failed',
      message: 'github dispatch fetch threw',
      context: {
        calendar_id: id,
        error: err instanceof Error ? err.name : 'unknown',
      },
      userId: r.user.id,
    });
    return NextResponse.json(
      { error: 'github dispatch failed' },
      { status: 502 },
    );
  }

  if (!dispatchRes.ok) {
    // Capture the response body server-side for debugging but never echo
    // it back to the client.
    const bodyForLog = await dispatchRes.text().catch(() => '');
    await revertStatus(supabase, id, priorStatus);
    await logEvent({
      source: 'web_server',
      level: 'error',
      category: 'schedule_ext_cal_sync_dispatch_failed',
      message: `github dispatch returned ${dispatchRes.status}`,
      context: {
        calendar_id: id,
        status: dispatchRes.status,
        body_excerpt: bodyForLog.slice(0, 300),
      },
      userId: r.user.id,
    });
    return NextResponse.json(
      { error: `github dispatch failed (${dispatchRes.status})` },
      { status: 502 },
    );
  }
  return NextResponse.json({ ok: true });
}

async function revertStatus(
  supabase: Awaited<ReturnType<typeof createClient>>,
  id: string,
  priorStatus: 'success' | 'failure' | 'running' | null,
): Promise<void> {
  // priorStatus may be 'running' if a previous dispatch was already in
  // flight; in that case we leave 'running' alone (the worker will clear
  // it). For null/success/failure we restore the snapshot so the UI
  // doesn't show a stuck spinner.
  if (priorStatus === 'running') return;
  await supabase
    .from('schedule_external_calendars')
    .update({ last_status: priorStatus })
    .eq('id', id);
}
