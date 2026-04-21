import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getAuthed } from '@/lib/server/authz';
import { logEvent } from '@/lib/logging/server';

export const runtime = 'nodejs';

const Body = z.object({
  status: z.enum(['new', 'acknowledged', 'in_progress', 'closed']).optional(),
  admin_response: z.string().max(2000).nullable().optional(),
});

type RouteParams = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: RouteParams) {
  const { id } = await params;

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
  if (parsed.data.status === undefined && parsed.data.admin_response === undefined) {
    return NextResponse.json(
      { error: 'Provide status or admin_response.' },
      { status: 400 },
    );
  }

  const update: Record<string, unknown> = {};
  if (parsed.data.status !== undefined) update.status = parsed.data.status;
  if (parsed.data.admin_response !== undefined) {
    update.admin_response = parsed.data.admin_response?.trim() || null;
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('feedback')
    .update(update)
    .eq('id', id)
    .select('id, status, admin_response')
    .maybeSingle();
  if (error) {
    await logEvent({
      source: 'web_server',
      level: 'error',
      category: 'api_exception',
      message: 'feedback PATCH failed',
      context: { id, code: error.code, message: error.message },
      userId: authz.user.id,
    });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: 'Feedback not found.' }, { status: 404 });
  }

  await logEvent({
    source: 'web_server',
    level: 'info',
    category: 'admin_feedback_updated',
    message: `feedback ${id} updated`,
    context: { id, update },
    userId: authz.user.id,
  });
  return NextResponse.json(data);
}
