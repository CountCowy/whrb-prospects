import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase/service';
import { getAuthed } from '@/lib/server/authz';
import { logEvent } from '@/lib/logging/server';

export const runtime = 'nodejs';

// Stage 10c: tightly-scoped argv whitelist. Any token outside this set → 400.
// Order of canonicalisation matches this array so `pipeline_runs.args` is
// stable across runs that pass the same flag set in different orders.
// `--stage10c-fixture` is a test-only sentinel: the dispatch trigger
// (migration 006) skips any row whose args contains it, so Playwright can
// exercise the endpoint without polluting the GitHub Actions queue. The
// workflow also strips it defensively before invoking pipeline.py.
const FLAG_WHITELIST = [
  '--dry',
  '--with-hic',
  '--with-bbb',
  '--fresh',
  '--no-supabase',
  '--stage10c-fixture',
] as const;
const FLAG_SET = new Set<string>(FLAG_WHITELIST);

const Body = z
  .object({
    args: z.string().max(200).optional(),
  })
  .strict();

function canonicaliseArgs(raw: string): { ok: true; args: string } | { ok: false; bad: string } {
  const tokens = raw
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  for (const t of tokens) {
    if (!FLAG_SET.has(t)) {
      return { ok: false, bad: t };
    }
  }
  // Canonical order + de-dupe.
  const picked = FLAG_WHITELIST.filter((f) => tokens.includes(f));
  return { ok: true, args: picked.join(' ') };
}

export async function POST(req: Request) {
  const authz = await getAuthed();
  if (authz.kind === 'unauth') {
    return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });
  }
  if (authz.user.role !== 'admin') {
    return NextResponse.json({ error: 'Admin role required.' }, { status: 403 });
  }

  let body: unknown = {};
  if (req.headers.get('content-length')?.trim() && req.headers.get('content-length') !== '0') {
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
    }
  }
  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json(
      { error: `Invalid payload: ${issue.path.join('.') || '<root>'} — ${issue.message}` },
      { status: 400 },
    );
  }

  let canonicalArgs: string | null = null;
  if (parsed.data.args && parsed.data.args.trim()) {
    const c = canonicaliseArgs(parsed.data.args);
    if (!c.ok) {
      return NextResponse.json(
        {
          error: `Unknown flag "${c.bad}". Allowed: ${FLAG_WHITELIST.join(', ')}`,
        },
        { status: 400 },
      );
    }
    canonicalArgs = c.args || null;
  }

  const service = createServiceClient();
  const { data, error } = await service
    .from('pipeline_runs')
    .insert({
      status: 'queued',
      triggered_by: authz.user.id,
      args: canonicalArgs,
    })
    .select('id')
    .single();

  if (error) {
    await logEvent({
      source: 'web_server',
      level: 'error',
      category: 'pipeline_run_enqueue_failed',
      message: 'pipeline_runs insert failed',
      context: { code: error.code, message: error.message },
      userId: authz.user.id,
    });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await logEvent({
    source: 'web_server',
    level: 'info',
    category: 'pipeline_run_enqueued',
    message: `pipeline run ${data.id} enqueued`,
    context: { pipeline_run_id: data.id, args: canonicalArgs },
    userId: authz.user.id,
  });

  return NextResponse.json({ pipeline_run_id: data.id, args: canonicalArgs }, { status: 201 });
}
