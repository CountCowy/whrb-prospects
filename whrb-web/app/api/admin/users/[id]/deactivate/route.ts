import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase/service';
import { getAuthed } from '@/lib/server/authz';
import { logEvent } from '@/lib/logging/server';

export const runtime = 'nodejs';

const Body = z.object({ deactivated: z.boolean() });

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

  if (parsed.data.deactivated && id === authz.user.id) {
    return NextResponse.json(
      { error: 'Cannot deactivate your own account.' },
      { status: 409 },
    );
  }

  const service = createServiceClient();
  const { data, error } = await service
    .from('profiles')
    .update({
      deactivated_at: parsed.data.deactivated ? new Date().toISOString() : null,
    })
    .eq('id', id)
    .select('id, email, deactivated_at')
    .maybeSingle();
  if (error) {
    await logEvent({
      source: 'web_server',
      level: 'error',
      category: 'api_exception',
      message: 'deactivate PATCH failed',
      context: { target: id, code: error.code, message: error.message },
      userId: authz.user.id,
    });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: 'User not found.' }, { status: 404 });
  }

  await logEvent({
    source: 'web_server',
    level: 'info',
    category: parsed.data.deactivated ? 'admin_user_deactivated' : 'admin_user_reactivated',
    message: `${parsed.data.deactivated ? 'deactivated' : 'reactivated'} ${data.email}`,
    context: { target: id },
    userId: authz.user.id,
  });
  return NextResponse.json(data);
}
