import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getAuthed } from '@/lib/server/authz';
import { logEvent } from '@/lib/logging/server';

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
  const update = {
    assigned_to: parsed.data.assigned_to,
    assigned_at: parsed.data.assigned_to ? new Date().toISOString() : null,
  };

  const { error } = await supabase
    .from('prospects')
    .update(update)
    .eq('id', id);
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
  return NextResponse.json({ ok: true, id, assigned_to: parsed.data.assigned_to });
}
