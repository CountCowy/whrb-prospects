import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getAuthed } from '@/lib/server/authz';
import { logEvent } from '@/lib/logging/server';

export const runtime = 'nodejs';

const AXES = [
  'sector',
  'operating_model',
  'genre',
  'affiliation',
  'cadence',
  'daypart_fit',
  'history',
  'compliance',
  'other',
] as const;

const STATUSES = ['active', 'pending_admin_review', 'deprecated'] as const;

const Body = z.object({
  axis: z.enum(AXES),
  // Tag values are lower_snake_case identifiers; allow only [a-z0-9_]+
  // up to 64 chars to keep the chip layer clean.
  value: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9_]+$/, 'value must be lower_snake_case [a-z0-9_]'),
  status: z.enum(STATUSES).optional(),
  replacement_id: z.string().uuid().nullable().optional(),
});

export async function POST(req: Request) {
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
  const parsed = Body.safeParse(json);
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
  const insertPayload: Record<string, unknown> = {
    axis: parsed.data.axis,
    value: parsed.data.value,
    created_by: authz.user.id,
  };
  if (parsed.data.status) insertPayload.status = parsed.data.status;
  if (parsed.data.replacement_id !== undefined) {
    insertPayload.replacement_id = parsed.data.replacement_id;
  }

  const { data, error } = await supabase
    .from('tag_vocabulary')
    .insert(insertPayload)
    .select('id, axis, value, status, replacement_id, created_at, updated_at')
    .maybeSingle();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json(
        { error: `Tag ${parsed.data.axis}:${parsed.data.value} already exists.` },
        { status: 409 },
      );
    }
    await logEvent({
      source: 'web_server',
      level: 'error',
      category: 'api_exception',
      message: 'tag_vocabulary POST failed',
      context: {
        axis: parsed.data.axis,
        value: parsed.data.value,
        code: error.code,
        message: error.message,
      },
      userId: authz.user.id,
    });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await logEvent({
    source: 'web_server',
    level: 'info',
    category: 'vocab_created',
    message: `created ${parsed.data.axis}:${parsed.data.value}`,
    context: { tag_id: data?.id, axis: parsed.data.axis, value: parsed.data.value },
    userId: authz.user.id,
  });

  return NextResponse.json(data, { status: 201 });
}
