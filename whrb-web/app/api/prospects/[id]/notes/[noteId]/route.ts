import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { getAuthed } from '@/lib/server/authz';
import { logEvent } from '@/lib/logging/server';

export const runtime = 'nodejs';

const PatchBody = z.object({
  body: z.string().min(1).max(5000).optional(),
  deleted: z.boolean().optional(),
  restore: z.boolean().optional(),
});

async function loadNote(supabase: Awaited<ReturnType<typeof createClient>>, noteId: string) {
  return supabase
    .from('prospect_notes')
    .select('id,prospect_id,author_id,deleted_at,body')
    .eq('id', noteId)
    .maybeSingle();
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; noteId: string }> },
) {
  const { id: prospectId, noteId } = await params;
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
  const parsed = PatchBody.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json(
      { error: `Invalid payload: ${issue.path.join('.') || '<root>'} — ${issue.message}` },
      { status: 400 },
    );
  }
  const { body, deleted, restore } = parsed.data;
  if (body === undefined && deleted === undefined && restore === undefined) {
    return NextResponse.json(
      { error: 'Provide at least one of { body, deleted, restore }.' },
      { status: 400 },
    );
  }
  if (restore && user.role !== 'admin') {
    return NextResponse.json(
      { error: 'Only admins may restore a soft-deleted note.' },
      { status: 403 },
    );
  }

  const supabase = await createClient();
  const { data: note, error: loadErr } = await loadNote(supabase, noteId);
  if (loadErr || !note) {
    return NextResponse.json(
      { error: loadErr?.message ?? 'Note not found.' },
      { status: 404 },
    );
  }
  if (note.prospect_id !== prospectId) {
    return NextResponse.json(
      { error: 'Note does not belong to this prospect.' },
      { status: 400 },
    );
  }

  const isAuthor = note.author_id === user.id;
  const isAdmin = user.role === 'admin';
  if (!isAuthor && !isAdmin) {
    return NextResponse.json(
      { error: 'Only the author or an admin may modify this note.' },
      { status: 403 },
    );
  }
  // Only the author may edit the body text; admins can delete/restore
  // but should not rewrite the author's words.
  if (body !== undefined && !isAuthor) {
    return NextResponse.json(
      { error: 'Only the author may edit the note body.' },
      { status: 403 },
    );
  }

  const update: Record<string, unknown> = {};
  if (body !== undefined) update['body'] = body.trim();
  if (deleted === true) {
    update['deleted_at'] = new Date().toISOString();
    update['deleted_by'] = user.id;
  }
  if (deleted === false) {
    // Author-initiated un-delete via PATCH { deleted: false } not currently supported
    // to avoid routing ambiguity; use { restore: true } (admin-only) instead.
    return NextResponse.json(
      { error: 'Use { restore: true } to undo a soft-delete (admin-only).' },
      { status: 400 },
    );
  }
  if (restore === true) {
    update['deleted_at'] = null;
    update['deleted_by'] = null;
  }

  // Writes that flip deleted_at cross the SELECT-policy boundary for the
  // returning row (the new row has deleted_at != null and `p_notes_read`
  // denies it for non-admins, which PostgREST surfaces as 42501). Auth was
  // validated above — use the service client for the actual write.
  const writeClient =
    deleted !== undefined || restore !== undefined ? createServiceClient() : supabase;
  const { error } = await writeClient.from('prospect_notes').update(update).eq('id', noteId);
  if (error) {
    await logEvent({
      source: 'web_server',
      level: 'error',
      category: 'api_exception',
      message: 'prospect_notes patch failed',
      context: { code: error.code, message: error.message, noteId },
      userId: user.id,
    });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Emit a dedicated activity event for soft-delete / restore so the
  // Activity tab can surface it even though prospect_notes has no audit
  // trigger of its own (Stage 7 §16.4 item 12).
  if (deleted === true) {
    await logEvent({
      source: 'web_server',
      level: 'info',
      category: 'note_deleted',
      message: `note soft-deleted on prospect ${prospectId}`,
      context: { prospect_id: prospectId, note_id: noteId, actor_id: user.id },
      userId: user.id,
    });
  }
  if (restore === true) {
    await logEvent({
      source: 'web_server',
      level: 'info',
      category: 'note_restored',
      message: `note restored on prospect ${prospectId}`,
      context: { prospect_id: prospectId, note_id: noteId, actor_id: user.id },
      userId: user.id,
    });
  }

  return NextResponse.json({ ok: true, id: noteId });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; noteId: string }> },
) {
  const { id: prospectId, noteId } = await params;
  const authz = await getAuthed();
  if (authz.kind === 'unauth') {
    return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });
  }
  const user = authz.user;

  const supabase = await createClient();
  const { data: note, error: loadErr } = await loadNote(supabase, noteId);
  if (loadErr || !note) {
    return NextResponse.json(
      { error: loadErr?.message ?? 'Note not found.' },
      { status: 404 },
    );
  }
  if (note.prospect_id !== prospectId) {
    return NextResponse.json(
      { error: 'Note does not belong to this prospect.' },
      { status: 400 },
    );
  }
  const isAuthor = note.author_id === user.id;
  const isAdmin = user.role === 'admin';
  if (!isAuthor && !isAdmin) {
    return NextResponse.json(
      { error: 'Only the author or an admin may delete this note.' },
      { status: 403 },
    );
  }

  const svc = createServiceClient();
  const { error } = await svc
    .from('prospect_notes')
    .update({ deleted_at: new Date().toISOString(), deleted_by: user.id })
    .eq('id', noteId);
  if (error) {
    await logEvent({
      source: 'web_server',
      level: 'error',
      category: 'api_exception',
      message: 'prospect_notes delete failed',
      context: { code: error.code, message: error.message, noteId },
      userId: user.id,
    });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  await logEvent({
    source: 'web_server',
    level: 'info',
    category: 'note_deleted',
    message: `note soft-deleted on prospect ${prospectId}`,
    context: { prospect_id: prospectId, note_id: noteId, actor_id: user.id },
    userId: user.id,
  });
  return NextResponse.json({ ok: true, id: noteId });
}
