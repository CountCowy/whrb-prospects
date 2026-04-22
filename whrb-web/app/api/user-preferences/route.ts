import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getAuthed } from '@/lib/server/authz';
import { logEvent } from '@/lib/logging/server';

export const runtime = 'nodejs';

const PREF_KEYS = [
  'notify_assignment_toast',
  'notify_assignment_email',
  'notify_mention_toast',
  'notify_mention_email',
  'notify_run_complete_email',
  'notify_feedback_status_email',
] as const;

type PrefKey = (typeof PREF_KEYS)[number];

const PatchBody = z.object(
  Object.fromEntries(PREF_KEYS.map((k) => [k, z.boolean().optional()])) as Record<
    PrefKey,
    z.ZodOptional<z.ZodBoolean>
  >,
);

const DEFAULTS: Record<PrefKey, boolean> = {
  notify_assignment_toast: true,
  notify_assignment_email: true,
  notify_mention_toast: true,
  notify_mention_email: false,
  notify_run_complete_email: false,
  notify_feedback_status_email: true,
};

export async function GET() {
  const authz = await getAuthed();
  if (authz.kind === 'unauth') {
    return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('user_preferences')
    .select('*')
    .eq('user_id', authz.user.id)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data ?? { user_id: authz.user.id, ...DEFAULTS });
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
  // Upsert on user_id so first-time savers don't need to insert separately.
  const payload = { user_id: authz.user.id, ...DEFAULTS, ...parsed.data };
  const { data, error } = await supabase
    .from('user_preferences')
    .upsert(payload, { onConflict: 'user_id' })
    .select('*')
    .single();
  if (error) {
    await logEvent({
      source: 'web_server',
      level: 'error',
      category: 'api_exception',
      message: 'user_preferences PATCH failed',
      context: { code: error.code, message: error.message },
      userId: authz.user.id,
    });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data);
}
