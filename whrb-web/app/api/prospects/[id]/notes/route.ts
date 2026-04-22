import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getAuthed } from '@/lib/server/authz';
import { logEvent } from '@/lib/logging/server';
import {
  extractMentionEmailPrefixes,
  notify,
  resolveMentionRecipients,
} from '@/lib/server/notifications';

export const runtime = 'nodejs';

const NoteBody = z.object({
  body: z.string().min(1).max(5000),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: prospectId } = await params;
  const authz = await getAuthed();
  if (authz.kind === 'unauth') {
    return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });
  }
  const user = authz.user;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const parsed = NoteBody.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json(
      { error: `Invalid payload: ${issue.path.join('.') || '<root>'} — ${issue.message}` },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const trimmedBody = parsed.data.body.trim();
  const { data, error } = await supabase
    .from('prospect_notes')
    .insert({
      prospect_id: prospectId,
      author_id: user.id,
      body: trimmedBody,
    })
    .select('id,created_at')
    .single();
  if (error) {
    await logEvent({
      source: 'web_server',
      level: 'error',
      category: 'api_exception',
      message: 'prospect_notes insert failed',
      context: { code: error.code, message: error.message, prospectId },
      userId: user.id,
    });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const prefixes = extractMentionEmailPrefixes(trimmedBody);
  if (prefixes.length > 0) {
    const recipients = await resolveMentionRecipients(prefixes);
    for (const r of recipients) {
      if (r.id === user.id) continue;
      await notify({
        recipientId: r.id,
        kind: 'note_mention',
        actorId: user.id,
        prospectId,
        payload: {
          note_id: data.id,
          actor_id: user.id,
          actor_email: user.email,
          mention_email_prefix: r.email.split('@')[0],
        },
      });
    }
  }

  return NextResponse.json({ id: data.id, created_at: data.created_at }, { status: 201 });
}
