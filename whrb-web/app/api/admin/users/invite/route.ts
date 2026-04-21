import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase/service';
import { getAuthed } from '@/lib/server/authz';
import { logEvent } from '@/lib/logging/server';

export const runtime = 'nodejs';

const Body = z.object({
  email: z.string().email().max(320),
  display_name: z.string().min(1).max(120).optional(),
});

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

  const service = createServiceClient();
  const { data, error } = await service.auth.admin.inviteUserByEmail(
    parsed.data.email,
  );
  if (error) {
    await logEvent({
      source: 'web_server',
      level: 'error',
      category: 'admin_user_invite_failed',
      message: 'inviteUserByEmail failed',
      context: { email: parsed.data.email, code: error.code, message: error.message },
      userId: authz.user.id,
    });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // The on_auth_user_created trigger inserts the profiles row. If an optional
  // display_name was supplied, update it now (tolerant of race — retry once).
  if (parsed.data.display_name && data.user?.id) {
    await service
      .from('profiles')
      .update({ display_name: parsed.data.display_name })
      .eq('id', data.user.id);
  }

  await logEvent({
    source: 'web_server',
    level: 'info',
    category: 'admin_user_invited',
    message: `invited ${parsed.data.email}`,
    context: { invited_user_id: data.user?.id ?? null },
    userId: authz.user.id,
  });

  return NextResponse.json(
    { user_id: data.user?.id ?? null, email: data.user?.email ?? parsed.data.email },
    { status: 201 },
  );
}
