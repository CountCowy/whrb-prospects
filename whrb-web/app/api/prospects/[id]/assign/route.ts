import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { getAuthed } from '@/lib/server/authz';
import { logEvent } from '@/lib/logging/server';
import { notify } from '@/lib/server/notifications';

export const runtime = 'nodejs';

const AssignBody = z.object({
  assigned_to: z.string().uuid().nullable(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
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
  const parsed = AssignBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Body must be { assigned_to: uuid | null }.' },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const service = createServiceClient();

  const { data: before, error: beforeErr } = await service
    .from('prospects')
    .select('id, assigned_to, company_name')
    .eq('id', id)
    .maybeSingle();
  if (beforeErr || !before) {
    return NextResponse.json(
      { error: beforeErr?.message ?? 'Prospect not found.' },
      { status: beforeErr ? 500 : 404 },
    );
  }

  const previousAssignee = before.assigned_to as string | null;
  const newAssignee = parsed.data.assigned_to;

  const update = {
    assigned_to: newAssignee,
    assigned_at: newAssignee ? new Date().toISOString() : null,
  };

  const { error } = await supabase.from('prospects').update(update).eq('id', id);
  if (error) {
    await logEvent({
      source: 'web_server',
      level: 'error',
      category: 'api_exception',
      message: 'prospect assign failed',
      context: { code: error.code, message: error.message, id },
      userId: user.id,
    });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const payloadBase = {
    prospect_id: id,
    prospect_name: (before.company_name as string) ?? null,
    actor_id: user.id,
    actor_email: user.email,
  };

  if (previousAssignee && previousAssignee !== newAssignee) {
    await notify({
      recipientId: previousAssignee,
      kind: 'unassigned',
      actorId: user.id,
      prospectId: id,
      payload: { ...payloadBase, new_assignee: newAssignee },
    });
  }
  if (newAssignee && newAssignee !== previousAssignee) {
    await notify({
      recipientId: newAssignee,
      kind: 'assigned',
      actorId: user.id,
      prospectId: id,
      payload: { ...payloadBase, previous_assignee: previousAssignee },
    });
  }

  return NextResponse.json({ ok: true, id, assigned_to: newAssignee });
}
