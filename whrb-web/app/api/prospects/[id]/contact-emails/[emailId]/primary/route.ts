import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getAuthed } from '@/lib/server/authz';
import { logEvent } from '@/lib/logging/server';

export const runtime = 'nodejs';

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

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string; emailId: string }> },
) {
  const { id, emailId } = await params;

  const authz = await getAuthed();
  if (authz.kind === 'unauth') {
    return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });
  }

  const supabase = await createClient();

  const { data: prospect, error: prospectErr } = await supabase
    .from('prospects')
    .select('id,assigned_to')
    .eq('id', id)
    .maybeSingle();
  if (prospectErr || !prospect) {
    return NextResponse.json(
      { error: prospectErr?.message ?? 'Prospect not found.' },
      { status: 404 },
    );
  }

  const isAdmin = authz.user.role === 'admin';
  const isAssignee = prospect.assigned_to === authz.user.id;
  if (!isAdmin && !isAssignee) {
    return NextResponse.json(
      { error: 'Only the assignee or an admin may edit this prospect.' },
      { status: 403 },
    );
  }

  const { data: target, error: targetErr } = await supabase
    .from('prospect_contact_emails')
    .select('id,is_primary')
    .eq('id', emailId)
    .eq('prospect_id', id)
    .maybeSingle();
  if (targetErr || !target) {
    return NextResponse.json(
      { error: targetErr?.message ?? 'Email not found on this prospect.' },
      { status: 404 },
    );
  }
  if (target.is_primary) {
    return NextResponse.json(
      { error: 'That email is already the primary.' },
      { status: 409 },
    );
  }

  const { error: rpcErr } = await supabase.rpc('set_primary_contact_email', {
    p_prospect_id: id,
    p_email_id: emailId,
  });
  if (rpcErr) {
    if (rpcErr.code === 'P0002') {
      return NextResponse.json(
        { error: 'Email not found on this prospect.' },
        { status: 404 },
      );
    }
    await logEvent({
      source: 'web_server',
      level: 'error',
      category: 'api_exception',
      message: 'set primary contact email failed',
      context: {
        code: rpcErr.code,
        message: rpcErr.message,
        id,
        emailId,
      },
      userId: authz.user.id,
    });
    return NextResponse.json({ error: rpcErr.message }, { status: 500 });
  }

  const { data, error } = await supabase
    .from('prospect_contact_emails')
    .select(EMAIL_COLUMNS)
    .eq('prospect_id', id)
    .order('is_primary', { ascending: false })
    .order('added_at', { ascending: true });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const emails = (data ?? []) as EmailRow[];
  const primary = emails.find((e) => e.is_primary)?.email ?? null;
  return NextResponse.json({ emails, primary, count: emails.length });
}
