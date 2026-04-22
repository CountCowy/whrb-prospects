import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getAuthed } from '@/lib/server/authz';
import { logEvent } from '@/lib/logging/server';

export const runtime = 'nodejs';

const PatchBody = z.union([
  z.object({
    id: z.string().uuid(),
    action: z.enum(['mark_read', 'mark_unread']),
  }),
  z.object({
    action: z.literal('mark_all_read'),
  }),
]);

export async function GET(req: Request) {
  const authz = await getAuthed();
  if (authz.kind === 'unauth') {
    return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });
  }
  const url = new URL(req.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 50), 1), 200);
  const unreadOnly = url.searchParams.get('unread') === '1';

  const supabase = await createClient();
  let q = supabase
    .from('notifications')
    .select('id,kind,prospect_id,actor_id,payload,read_at,email_sent_at,created_at', {
      count: 'exact',
    })
    .eq('recipient_id', authz.user.id)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (unreadOnly) q = q.is('read_at', null);

  const { data, error, count } = await q;
  if (error) {
    await logEvent({
      source: 'web_server',
      level: 'error',
      category: 'api_exception',
      message: 'notifications GET failed',
      context: { code: error.code, message: error.message },
      userId: authz.user.id,
    });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { count: unreadCountVal } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('recipient_id', authz.user.id)
    .is('read_at', null);

  return NextResponse.json({
    items: data ?? [],
    total: count ?? (data?.length ?? 0),
    unread: unreadCountVal ?? 0,
  });
}

export async function PATCH(req: Request) {
  const authz = await getAuthed();
  if (authz.kind === 'unauth') {
    return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const parsed = PatchBody.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json(
      { error: `Invalid payload: ${issue.path.join('.') || '<root>'} — ${issue.message}` },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const now = new Date().toISOString();

  if (parsed.data.action === 'mark_all_read') {
    const { error, count } = await supabase
      .from('notifications')
      .update({ read_at: now }, { count: 'exact' })
      .eq('recipient_id', authz.user.id)
      .is('read_at', null);
    if (error) {
      await logEvent({
        source: 'web_server',
        level: 'error',
        category: 'api_exception',
        message: 'notifications mark-all-read failed',
        context: { code: error.code, message: error.message },
        userId: authz.user.id,
      });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, updated: count ?? 0 });
  }

  const { id, action } = parsed.data;
  const patch = { read_at: action === 'mark_read' ? now : null };
  const { data, error } = await supabase
    .from('notifications')
    .update(patch)
    .eq('id', id)
    .eq('recipient_id', authz.user.id)
    .select('id,read_at')
    .maybeSingle();
  if (error) {
    await logEvent({
      source: 'web_server',
      level: 'error',
      category: 'api_exception',
      message: 'notification PATCH failed',
      context: { code: error.code, message: error.message, id },
      userId: authz.user.id,
    });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: 'Notification not found.' }, { status: 404 });
  }
  return NextResponse.json(data);
}
