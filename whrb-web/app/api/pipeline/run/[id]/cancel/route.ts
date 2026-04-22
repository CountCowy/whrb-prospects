import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase/service';
import { getAuthed } from '@/lib/server/authz';
import { logEvent } from '@/lib/logging/server';

export const runtime = 'nodejs';

// Stage 10c: default repo target for the cancel-running workflow call.
// Matches the repo the run-pipeline.yml workflow lives in. Override via env
// GH_REPO_OWNER / GH_REPO_NAME for preview environments if needed.
const GH_OWNER = process.env.GH_REPO_OWNER || 'CountCowy';
const GH_REPO = process.env.GH_REPO_NAME || 'whrb-prospects';

type CancelRow = {
  id: string;
  status: 'queued' | 'running' | 'success' | 'failed';
  github_run_id: number | null;
};

async function cancelGithubRun(
  ghRunId: number,
  pat: string,
): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/actions/runs/${ghRunId}/cancel`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${pat}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    // 202 = accepted (GH convention). 404 = run already finished / wrong id.
    if (res.status === 202) return { ok: true };
    if (res.status === 404) {
      return { ok: false, status: 404, message: 'github run not found (may have already finished)' };
    }
    const text = await res.text().catch(() => '');
    return { ok: false, status: res.status, message: text.slice(0, 200) };
  } catch (err) {
    return { ok: false, status: 0, message: (err as Error).message };
  }
}

const ParamsSchema = z.object({ id: z.string().uuid() });

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authz = await getAuthed();
  if (authz.kind === 'unauth') {
    return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });
  }
  if (authz.user.role !== 'admin') {
    return NextResponse.json({ error: 'Admin role required.' }, { status: 403 });
  }

  const rawParams = await params;
  const parsed = ParamsSchema.safeParse(rawParams);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid run id.' }, { status: 400 });
  }
  const runId = parsed.data.id;

  const service = createServiceClient();
  const { data: row, error: readErr } = await service
    .from('pipeline_runs')
    .select('id,status,github_run_id')
    .eq('id', runId)
    .maybeSingle();
  if (readErr) {
    await logEvent({
      source: 'web_server',
      level: 'error',
      category: 'api_exception',
      message: 'cancel: pipeline_runs read failed',
      context: { pipeline_run_id: runId, code: readErr.code, message: readErr.message },
      userId: authz.user.id,
    });
    return NextResponse.json({ error: readErr.message }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ error: 'Run not found.' }, { status: 404 });
  }

  const typed = row as CancelRow;

  if (typed.status === 'success' || typed.status === 'failed') {
    return NextResponse.json(
      { error: `Run already ${typed.status}; cannot cancel.` },
      { status: 400 },
    );
  }

  const now = new Date().toISOString();
  const adminEmail = authz.user.email;

  if (typed.status === 'queued') {
    const errMark = `cancelled by admin: ${adminEmail} (queued)`;
    const { error: updErr } = await service
      .from('pipeline_runs')
      .update({ status: 'failed', finished_at: now, error: errMark })
      .eq('id', runId)
      .eq('status', 'queued');
    if (updErr) {
      return NextResponse.json({ error: updErr.message }, { status: 500 });
    }
    await logEvent({
      source: 'web_server',
      level: 'info',
      category: 'admin_cancel_run',
      message: `admin cancelled queued run ${runId}`,
      context: { pipeline_run_id: runId, previous_status: 'queued', admin_email: adminEmail },
      userId: authz.user.id,
    });
    return NextResponse.json({ ok: true, status: 'failed', mode: 'queued' });
  }

  // status === 'running'
  const pat = process.env.GH_DISPATCH_PAT;
  if (!pat) {
    await logEvent({
      source: 'web_server',
      level: 'error',
      category: 'admin_cancel_run_failed',
      message: 'cancel-running requires GH_DISPATCH_PAT; env var missing',
      context: { pipeline_run_id: runId, admin_email: adminEmail },
      userId: authz.user.id,
    });
    return NextResponse.json(
      { error: 'GH_DISPATCH_PAT env var missing on server; cannot cancel workflow.' },
      { status: 503 },
    );
  }

  const ghRunId = typed.github_run_id;
  let ghResult: { ok: true } | { ok: false; status: number; message: string } | null = null;
  if (ghRunId != null) {
    ghResult = await cancelGithubRun(ghRunId, pat);
    // Auth failure (401/403) surfaces to admin without mutating our row.
    if (!ghResult.ok && (ghResult.status === 401 || ghResult.status === 403)) {
      await logEvent({
        source: 'web_server',
        level: 'error',
        category: 'admin_cancel_run_failed',
        message: `github cancel rejected (${ghResult.status}) — PAT scope issue`,
        context: {
          pipeline_run_id: runId,
          github_run_id: ghRunId,
          gh_status: ghResult.status,
          gh_message: ghResult.message,
          admin_email: adminEmail,
        },
        userId: authz.user.id,
      });
      return NextResponse.json(
        {
          error: `GitHub rejected cancel (${ghResult.status}). Check GH_DISPATCH_PAT scope.`,
        },
        { status: 502 },
      );
    }
  }

  const marker =
    ghRunId == null
      ? `cancelled by admin: ${adminEmail} (running, gh_run=null)`
      : ghResult && ghResult.ok
        ? `cancelled by admin: ${adminEmail} (running, gh_run=${ghRunId})`
        : `cancelled by admin: ${adminEmail} (running, gh_run=${ghRunId}, gh-${ghResult && ghResult.status === 404 ? 'run-not-found' : 'cancel-error'})`;

  const { error: updErr } = await service
    .from('pipeline_runs')
    .update({ status: 'failed', finished_at: now, error: marker })
    .eq('id', runId)
    .eq('status', 'running');
  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  await logEvent({
    source: 'web_server',
    level: 'info',
    category: 'admin_cancel_run',
    message: `admin cancelled running run ${runId}`,
    context: {
      pipeline_run_id: runId,
      previous_status: 'running',
      github_run_id: ghRunId,
      gh_cancel: ghResult && ghResult.ok ? 'ok' : ghResult ? `error:${ghResult.status}` : 'skipped_no_id',
      admin_email: adminEmail,
    },
    userId: authz.user.id,
  });

  return NextResponse.json({
    ok: true,
    status: 'failed',
    mode: 'running',
    github_run_id: ghRunId,
    gh_cancel: ghResult && ghResult.ok ? 'ok' : ghResult ? `error:${ghResult.status}` : 'skipped_no_id',
  });
}
