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

const PatchBody = z
  .object({
    axis: z.enum(AXES).optional(),
    value: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9_]+$/, 'value must be lower_snake_case [a-z0-9_]')
      .optional(),
    status: z.enum(STATUSES).optional(),
    replacement_id: z.string().uuid().nullable().optional(),
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

  // Read current row first so we can compute axis-change diff for audit.
  const { data: prior, error: priorError } = await supabase
    .from('tag_vocabulary')
    .select('id, axis, value, status, replacement_id')
    .eq('id', id)
    .maybeSingle();
  if (priorError) {
    return NextResponse.json({ error: priorError.message }, { status: 500 });
  }
  if (!prior) {
    return NextResponse.json({ error: 'Tag not found.' }, { status: 404 });
  }

  const update: Record<string, unknown> = {};
  if (parsed.data.axis !== undefined) update.axis = parsed.data.axis;
  if (parsed.data.value !== undefined) update.value = parsed.data.value;
  if (parsed.data.status !== undefined) update.status = parsed.data.status;
  if (parsed.data.replacement_id !== undefined) {
    update.replacement_id = parsed.data.replacement_id;
  }

  const { data, error } = await supabase
    .from('tag_vocabulary')
    .update(update)
    .eq('id', id)
    .select('id, axis, value, status, replacement_id, created_at, updated_at')
    .maybeSingle();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json(
        { error: `Conflicting tag (axis,value) already exists.` },
        { status: 409 },
      );
    }
    await logEvent({
      source: 'web_server',
      level: 'error',
      category: 'api_exception',
      message: 'tag_vocabulary PATCH failed',
      context: { id, code: error.code, message: error.message },
      userId: authz.user.id,
    });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: 'Tag not found.' }, { status: 404 });
  }

  // Axis-change audit per plan §3.4: emits vocab_axis_changed with the
  // affected_prospect_count so the cross-axis reclassification flow is
  // observable in /admin/logs.
  if (parsed.data.axis !== undefined && parsed.data.axis !== prior.axis) {
    const { count } = await supabase
      .from('prospect_tags')
      .select('id', { count: 'exact', head: true })
      .eq('tag_id', id);
    await logEvent({
      source: 'web_server',
      level: 'info',
      category: 'vocab_axis_changed',
      message: `tag ${id} axis ${prior.axis} -> ${parsed.data.axis}`,
      context: {
        id,
        from_axis: prior.axis,
        to_axis: parsed.data.axis,
        affected_prospect_count: count ?? 0,
      },
      userId: authz.user.id,
    });
  }

  // Status / value / replacement edits get a lighter-weight audit event.
  const otherChanges = Object.entries(update).filter(
    ([k]) => k !== 'axis',
  );
  if (otherChanges.length > 0) {
    await logEvent({
      source: 'web_server',
      level: 'info',
      category: 'vocab_updated',
      message: `tag ${id} updated`,
      context: { id, changes: Object.fromEntries(otherChanges) },
      userId: authz.user.id,
    });
  }

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

  // Cascade delete prospect_tags first (the FK has no on delete cascade so
  // we do it explicitly — otherwise the DELETE on tag_vocabulary fails on
  // FK violation if any prospect_tags exist).
  const { error: cascadeError } = await supabase
    .from('prospect_tags')
    .delete()
    .eq('tag_id', id);
  if (cascadeError) {
    await logEvent({
      source: 'web_server',
      level: 'error',
      category: 'api_exception',
      message: 'tag_vocabulary DELETE cascade-prospect_tags failed',
      context: { id, code: cascadeError.code, message: cascadeError.message },
      userId: authz.user.id,
    });
    return NextResponse.json({ error: cascadeError.message }, { status: 500 });
  }

  const { data, error } = await supabase
    .from('tag_vocabulary')
    .delete()
    .eq('id', id)
    .select('id, axis, value')
    .maybeSingle();

  if (error) {
    await logEvent({
      source: 'web_server',
      level: 'error',
      category: 'api_exception',
      message: 'tag_vocabulary DELETE failed',
      context: { id, code: error.code, message: error.message },
      userId: authz.user.id,
    });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: 'Tag not found.' }, { status: 404 });
  }

  await logEvent({
    source: 'web_server',
    level: 'info',
    category: 'vocab_deleted',
    message: `deleted ${data.axis}:${data.value}`,
    context: { id, axis: data.axis, value: data.value },
    userId: authz.user.id,
  });

  return NextResponse.json({ ok: true, ...data });
}
