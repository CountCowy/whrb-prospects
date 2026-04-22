import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getAuthed } from '@/lib/server/authz';
import { logEvent } from '@/lib/logging/server';

export const runtime = 'nodejs';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: prospectId } = await params;
  const authz = await getAuthed();
  if (authz.kind === 'unauth') {
    return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from('prospect_presence')
    .upsert(
      {
        prospect_id: prospectId,
        user_id: authz.user.id,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'prospect_id,user_id' },
    );
  if (error) {
    await logEvent({
      source: 'web_server',
      level: 'warn',
      category: 'presence_upsert_failed',
      message: 'prospect_presence upsert failed',
      context: { code: error.code, message: error.message, prospect_id: prospectId },
      userId: authz.user.id,
    });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, prospect_id: prospectId });
}
