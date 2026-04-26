import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getAuthed } from '@/lib/server/authz';
import { logEvent } from '@/lib/logging/server';

export const runtime = 'nodejs';

const UpdateEmailBody = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email('Email must be a valid address.')
    .max(200, 'Email must be 200 characters or fewer.'),
});

const EMAIL_COLUMNS =
  'id,prospect_id,email,source,is_primary,added_by,added_at,updated_at';

type EmailRow = {
  id: string;
  prospect_id: string;
  email: string;
  source: string;
  is_primary: boolean;
  added_by: string | null;
  added_at: string;
  updated_at: string;
};

async function loadAndAuth(prospectId: string, emailId: string) {
  const authz = await getAuthed();
  if (authz.kind === 'unauth') {
    return {
      kind: 'unauth' as const,
      response: NextResponse.json(
        { error: 'Unauthenticated.' },
        { status: 401 },
      ),
    };
  }
  const supabase = await createClient();
  const { data: prospect, error: prospectErr } = await supabase
    .from('prospects')
    .select('id,assigned_to')
    .eq('id', prospectId)
    .maybeSingle();
  if (prospectErr || !prospect) {
    return {
      kind: 'notfound' as const,
      response: NextResponse.json(
        { error: prospectErr?.message ?? 'Prospect not found.' },
        { status: 404 },
      ),
    };
  }
  const { data: email, error: emailErr } = await supabase
    .from('prospect_contact_emails')
    .select(EMAIL_COLUMNS)
    .eq('id', emailId)
    .eq('prospect_id', prospectId)
    .maybeSingle();
  if (emailErr || !email) {
    return {
      kind: 'notfound' as const,
      response: NextResponse.json(
        { error: emailErr?.message ?? 'Email not found on this prospect.' },
        { status: 404 },
      ),
    };
  }
  const isAdmin = authz.user.role === 'admin';
  const isAssignee = prospect.assigned_to === authz.user.id;
  return {
    kind: 'ok' as const,
    user: authz.user,
    isAdmin,
    isAssignee,
    supabase,
    email: email as EmailRow,
  };
}

async function fetchSnapshot(supabase: Awaited<ReturnType<typeof createClient>>, prospectId: string) {
  const { data, error } = await supabase
    .from('prospect_contact_emails')
    .select(EMAIL_COLUMNS)
    .eq('prospect_id', prospectId)
    .order('is_primary', { ascending: false })
    .order('added_at', { ascending: true });
  if (error) throw error;
  const emails = (data ?? []) as EmailRow[];
  const primary = emails.find((e) => e.is_primary)?.email ?? null;
  return { emails, primary, count: emails.length };
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; emailId: string }> },
) {
  const { id, emailId } = await params;
  const ctx = await loadAndAuth(id, emailId);
  if (ctx.kind !== 'ok') return ctx.response;
  if (!ctx.isAdmin && !ctx.isAssignee) {
    return NextResponse.json(
      { error: 'Only the assignee or an admin may edit this prospect.' },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const parsed = UpdateEmailBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid payload.' },
      { status: 400 },
    );
  }

  const { error: updErr } = await ctx.supabase
    .from('prospect_contact_emails')
    .update({ email: parsed.data.email })
    .eq('id', emailId)
    .eq('prospect_id', id);
  if (updErr) {
    if (updErr.code === '23505') {
      return NextResponse.json(
        { error: 'That email is already on this prospect.' },
        { status: 409 },
      );
    }
    if (updErr.code === '23514') {
      return NextResponse.json(
        { error: 'Email failed format or length validation.' },
        { status: 400 },
      );
    }
    await logEvent({
      source: 'web_server',
      level: 'error',
      category: 'api_exception',
      message: 'update contact email failed',
      context: {
        code: updErr.code,
        message: updErr.message,
        id,
        emailId,
      },
      userId: ctx.user.id,
    });
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  try {
    const snapshot = await fetchSnapshot(ctx.supabase, id);
    return NextResponse.json(snapshot);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; emailId: string }> },
) {
  const { id, emailId } = await params;
  const ctx = await loadAndAuth(id, emailId);
  if (ctx.kind !== 'ok') return ctx.response;
  if (!ctx.isAdmin && !ctx.isAssignee) {
    return NextResponse.json(
      { error: 'Only the assignee or an admin may edit this prospect.' },
      { status: 403 },
    );
  }

  const { error: delErr } = await ctx.supabase
    .from('prospect_contact_emails')
    .delete()
    .eq('id', emailId)
    .eq('prospect_id', id);
  if (delErr) {
    await logEvent({
      source: 'web_server',
      level: 'error',
      category: 'api_exception',
      message: 'delete contact email failed',
      context: {
        code: delErr.code,
        message: delErr.message,
        id,
        emailId,
      },
      userId: ctx.user.id,
    });
    return NextResponse.json({ error: delErr.message }, { status: 500 });
  }

  try {
    const snapshot = await fetchSnapshot(ctx.supabase, id);
    return NextResponse.json(snapshot);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
