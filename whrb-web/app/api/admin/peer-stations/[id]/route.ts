import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getAuthed } from '@/lib/server/authz';
import { logEvent } from '@/lib/logging/server';

export const runtime = 'nodejs';

const STATUSES = ['active', 'deprecated'] as const;
const NORM_RE = /^[a-z0-9 ]+$/;

const PatchBody = z
  .object({
    display_name: z.string().min(1).max(120).optional(),
    normalized_name: z.string().min(1).max(120).regex(NORM_RE).optional(),
    status: z.enum(STATUSES).optional(),
    notes: z.string().max(2000).nullable().optional(),
  })
  .refine(
    (v) => Object.keys(v).length > 0,
    'PATCH body must contain at least one field.',
  );

type RouteParams = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: RouteParams) {
  const { id } = await params;
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
  const parsed = PatchBody.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json(
      {
        error: `Invalid payload: ${issue.path.join('.') || '<root>'} — ${issue.message}`,
      },
      { status: 400 },
    );
  }

  const supabase = await createClient();

  const update: Record<string, unknown> = {};
  if (parsed.data.display_name !== undefined) {
    update.display_name = parsed.data.display_name.trim();
  }
  if (parsed.data.normalized_name !== undefined) {
    update.normalized_name = parsed.data.normalized_name.trim();
  }
  if (parsed.data.status !== undefined) update.status = parsed.data.status;
  if (parsed.data.notes !== undefined) update.notes = parsed.data.notes;

  const { data, error } = await supabase
    .from('peer_stations')
    .update(update)
    .eq('id', id)
    .select(
      'id, normalized_name, display_name, status, added_by, notes, created_at, updated_at',
    )
    .maybeSingle();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json(
        { error: `Conflicting normalized_name already exists.` },
        { status: 409 },
      );
    }
    await logEvent({
      source: 'web_server',
      level: 'error',
      category: 'api_exception',
      message: 'peer_stations PATCH failed',
      context: { id, code: error.code, message: error.message },
      userId: authz.user.id,
    });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: 'Peer station not found.' }, { status: 404 });
  }

  await logEvent({
    source: 'web_server',
    level: 'info',
    category: 'peer_station_updated',
    message: `peer_station ${id} updated`,
    context: { id, changes: update },
    userId: authz.user.id,
  });

  return NextResponse.json(data);
}

export async function DELETE(_req: Request, { params }: RouteParams) {
  const { id } = await params;
  const authz = await getAuthed();
  if (authz.kind === 'unauth') {
    return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });
  }
  if (authz.user.role !== 'admin') {
    return NextResponse.json({ error: 'Admin role required.' }, { status: 403 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('peer_stations')
    .delete()
    .eq('id', id)
    .select('id, normalized_name, display_name')
    .maybeSingle();

  if (error) {
    await logEvent({
      source: 'web_server',
      level: 'error',
      category: 'api_exception',
      message: 'peer_stations DELETE failed',
      context: { id, code: error.code, message: error.message },
      userId: authz.user.id,
    });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: 'Peer station not found.' }, { status: 404 });
  }

  await logEvent({
    source: 'web_server',
    level: 'info',
    category: 'peer_station_deleted',
    message: `deleted peer station ${data.display_name}`,
    context: { id, normalized_name: data.normalized_name, display_name: data.display_name },
    userId: authz.user.id,
  });

  return NextResponse.json({ ok: true, ...data });
}
