import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase/service';
import { getAuthed } from '@/lib/server/authz';
import { logEvent } from '@/lib/logging/server';

export const runtime = 'nodejs';

const Body = z
  .object({
    args: z.string().max(200).optional(),
  })
  .strict();

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

  const service = createServiceClient();
  const { data, error } = await service
    .from('pipeline_runs')
    .insert({
      status: 'queued',
      triggered_by: authz.user.id,
      args: parsed.data.args ?? null,
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
    context: { pipeline_run_id: data.id, args: parsed.data.args ?? null },
    userId: authz.user.id,
  });

  return NextResponse.json({ pipeline_run_id: data.id }, { status: 201 });
}
