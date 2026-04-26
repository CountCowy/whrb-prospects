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

const PostBody = z
  .union([
    // Pick existing vocab. Optional locked_by carries through undo
    // restores so the chip's lock state survives delete + undo round-trips.
    z.object({
      tag_id: z.string().uuid(),
      locked_by: z.string().uuid().nullable().optional(),
    }),
    // Propose new vocab + use it on this prospect.
    z.object({
      is_new_vocab: z.literal(true),
      axis: z.enum(AXES),
      value: z
        .string()
        .min(1)
        .max(64)
        .regex(/^[a-z0-9_]+$/, 'value must be lower_snake_case [a-z0-9_]'),
    }),
  ]);

const PatchBody = z.object({
  locked_by: z.string().uuid().nullable(),
});

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: RouteParams) {
  const { id: prospectId } = await params;
  const authz = await getAuthed();
  if (authz.kind === 'unauth') {
    return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('prospect_tags')
    .select(
      'id, prospect_id, tag_id, created_by, locked_by, locked_at, ' +
        'tag_vocabulary!inner(axis, value, status)',
    )
    .eq('prospect_id', prospectId)
    .is('suppressed_at', null);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Flatten the tag_vocabulary join into the same `ProspectTagView` shape
  // the client lib expects.
  type RawRow = {
    id: string;
    prospect_id: string;
    tag_id: string;
    created_by: string | null;
    locked_by: string | null;
    locked_at: string | null;
    tag_vocabulary: { axis: string; value: string; status: string } | null;
  };
  const flat = ((data ?? []) as unknown as RawRow[])
    .filter((r): r is RawRow & { tag_vocabulary: NonNullable<RawRow['tag_vocabulary']> } =>
      Boolean(r.tag_vocabulary),
    )
    .map((r) => ({
      id: r.id,
      prospect_id: r.prospect_id,
      tag_id: r.tag_id,
      axis: r.tag_vocabulary.axis,
      value: r.tag_vocabulary.value,
      status: r.tag_vocabulary.status,
      created_by: r.created_by,
      locked_by: r.locked_by,
      locked_at: r.locked_at,
    }));
  return NextResponse.json(flat, { status: 200 });
}

export async function POST(req: Request, { params }: RouteParams) {
  const { id: prospectId } = await params;
  const authz = await getAuthed();
  if (authz.kind === 'unauth') {
    return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const parsed = PostBody.safeParse(json);
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
  let tagId: string;

  if ('is_new_vocab' in parsed.data) {
    // Insert vocab row first. The on_rep_tag_vocab_insert trigger forces
    // status=pending_admin_review for non-admin authors and fans out the
    // moderation notification. Admin authors keep status=active.
    const { data: vocabRow, error: vocabErr } = await supabase
      .from('tag_vocabulary')
      .insert({
        axis: parsed.data.axis,
        value: parsed.data.value,
        // created_by stamped by trigger when null + actor non-null.
      })
      .select('id, axis, value, status')
      .maybeSingle();
    if (vocabErr) {
      // 23505 = (axis, value) collision → return the existing row's id
      // so the rep can use the existing pending or active vocab without a
      // duplicate notification. The trigger's dedup branch picks up here.
      if (vocabErr.code === '23505') {
        const { data: existing } = await supabase
          .from('tag_vocabulary')
          .select('id')
          .eq('axis', parsed.data.axis)
          .eq('value', parsed.data.value)
          .maybeSingle();
        if (!existing) {
          return NextResponse.json(
            { error: vocabErr.message },
            { status: 500 },
          );
        }
        tagId = existing.id as string;
      } else {
        await logEvent({
          source: 'web_server',
          level: 'error',
          category: 'api_exception',
          message: 'prospect_tags POST vocab insert failed',
          context: {
            prospect_id: prospectId,
            axis: parsed.data.axis,
            value: parsed.data.value,
            code: vocabErr.code,
            message: vocabErr.message,
          },
          userId: authz.user.id,
        });
        return NextResponse.json({ error: vocabErr.message }, { status: 500 });
      }
    } else {
      tagId = vocabRow!.id as string;
    }
  } else {
    tagId = parsed.data.tag_id;
  }

  // Look for an existing prospect_tags row, suppressed or not. Compliance
  // axis re-add is a soft un-suppress; everything else either inserts or
  // returns 409 if the tag is already attached.
  const { data: existing, error: existingErr } = await supabase
    .from('prospect_tags')
    .select('id, suppressed_at, locked_by, created_by, tag_vocabulary!inner(axis)')
    .eq('prospect_id', prospectId)
    .eq('tag_id', tagId)
    .maybeSingle();
  if (existingErr) {
    return NextResponse.json({ error: existingErr.message }, { status: 500 });
  }

  if (existing) {
    if (existing.suppressed_at !== null) {
      // Idempotent re-add: clear the soft-clear stamps. Plan §1.3 #24.
      const { data: unsupp, error: unsuppErr } = await supabase
        .from('prospect_tags')
        .update({ suppressed_at: null, suppressed_by: null })
        .eq('id', existing.id)
        .select('id, prospect_id, tag_id, created_by, locked_by, locked_at')
        .maybeSingle();
      if (unsuppErr) {
        return NextResponse.json({ error: unsuppErr.message }, { status: 500 });
      }
      return NextResponse.json(unsupp, { status: 200 });
    }
    return NextResponse.json(
      { error: 'Tag is already attached to this prospect.' },
      { status: 409 },
    );
  }

  // Fresh insert. created_by = actor; optional locked_by passed only on
  // undo restores.
  // Mirror PATCH (lines below): non-admins may only attribute a lock to
  // themselves. Without this gate a crafted POST with `locked_by:
  // <other_uuid>` would create a tag row falsely attributed to that
  // user — RLS does not gate the locked_by field on INSERT.
  if ('tag_id' in parsed.data && parsed.data.locked_by) {
    if (
      parsed.data.locked_by !== authz.user.id &&
      authz.user.role !== 'admin'
    ) {
      return NextResponse.json(
        { error: 'Reps may only lock tags as themselves.' },
        { status: 403 },
      );
    }
  }
  const insertPayload: Record<string, unknown> = {
    prospect_id: prospectId,
    tag_id: tagId,
    created_by: authz.user.id,
  };
  if ('tag_id' in parsed.data && parsed.data.locked_by !== undefined) {
    if (parsed.data.locked_by) {
      insertPayload.locked_by = parsed.data.locked_by;
      insertPayload.locked_at = new Date().toISOString();
    }
  }

  const { data: inserted, error: insertErr } = await supabase
    .from('prospect_tags')
    .insert(insertPayload)
    .select('id, prospect_id, tag_id, created_by, locked_by, locked_at')
    .maybeSingle();
  if (insertErr) {
    await logEvent({
      source: 'web_server',
      level: 'error',
      category: 'api_exception',
      message: 'prospect_tags POST insert failed',
      context: {
        prospect_id: prospectId,
        tag_id: tagId,
        code: insertErr.code,
        message: insertErr.message,
      },
      userId: authz.user.id,
    });
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  return NextResponse.json(inserted, { status: 201 });
}

export async function DELETE(req: Request, { params }: RouteParams) {
  const { id: prospectId } = await params;
  const url = new URL(req.url);
  const tagRowId = url.searchParams.get('tag_row_id');
  if (!tagRowId) {
    return NextResponse.json(
      { error: 'tag_row_id query param required.' },
      { status: 400 },
    );
  }

  const authz = await getAuthed();
  if (authz.kind === 'unauth') {
    return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });
  }

  const supabase = await createClient();

  const { data: row, error: rowErr } = await supabase
    .from('prospect_tags')
    .select('id, prospect_id, tag_id, created_by, locked_by, suppressed_at, tag_vocabulary!inner(axis, value)')
    .eq('id', tagRowId)
    .eq('prospect_id', prospectId)
    .maybeSingle();
  if (rowErr) {
    return NextResponse.json({ error: rowErr.message }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ error: 'Tag row not found.' }, { status: 404 });
  }

  // Lock-aware: non-admin users can only delete rows they locked themselves
  // or unlocked rows. RLS enforces the same gate but mirroring the check
  // here gives a clearer 403 than a silent zero-row delete.
  if (
    authz.user.role !== 'admin' &&
    row.locked_by !== null &&
    row.locked_by !== authz.user.id
  ) {
    return NextResponse.json(
      { error: 'Tag is locked by another user.' },
      { status: 403 },
    );
  }

  const vocab = (row.tag_vocabulary as unknown as { axis: string; value: string });
  const isCompliance = vocab.axis === 'compliance';

  if (isCompliance && row.suppressed_at === null) {
    // Soft-clear: UPDATE suppressed_at + suppressed_by. Plan §1.3 #24.
    const { error: supErr } = await supabase
      .from('prospect_tags')
      .update({ suppressed_at: new Date().toISOString(), suppressed_by: authz.user.id })
      .eq('id', tagRowId);
    if (supErr) {
      return NextResponse.json({ error: supErr.message }, { status: 500 });
    }
    await logEvent({
      source: 'web_server',
      level: 'info',
      category: 'compliance_cleared',
      message: `compliance:${vocab.value} soft-cleared on prospect ${prospectId}`,
      context: {
        prospect_id: prospectId,
        tag_id: row.tag_id,
        tag_row_id: tagRowId,
        axis: vocab.axis,
        value: vocab.value,
      },
      userId: authz.user.id,
    });
    return NextResponse.json(
      {
        ok: true,
        soft_clear: true,
        snapshot: {
          tag_row_id: tagRowId,
          tag_id: row.tag_id,
          prospect_id: prospectId,
          locked_by: row.locked_by,
        },
      },
      { status: 200 },
    );
  }

  // Hard delete. The audit trigger emits prospect_tag_removed; the
  // on_tag_removed_by_other trigger fires too (silent on self-deletes).
  const { error: delErr } = await supabase
    .from('prospect_tags')
    .delete()
    .eq('id', tagRowId);
  if (delErr) {
    return NextResponse.json({ error: delErr.message }, { status: 500 });
  }
  return NextResponse.json(
    {
      ok: true,
      soft_clear: false,
      snapshot: {
        tag_row_id: tagRowId,
        tag_id: row.tag_id,
        prospect_id: prospectId,
        locked_by: row.locked_by,
      },
    },
    { status: 200 },
  );
}

export async function PATCH(req: Request, { params }: RouteParams) {
  const { id: prospectId } = await params;
  const url = new URL(req.url);
  const tagRowId = url.searchParams.get('tag_row_id');
  if (!tagRowId) {
    return NextResponse.json(
      { error: 'tag_row_id query param required.' },
      { status: 400 },
    );
  }

  const authz = await getAuthed();
  if (authz.kind === 'unauth') {
    return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const parsed = PatchBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'PATCH body must be {locked_by: uuid|null}' },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const { data: row, error: rowErr } = await supabase
    .from('prospect_tags')
    .select('id, locked_by')
    .eq('id', tagRowId)
    .eq('prospect_id', prospectId)
    .maybeSingle();
  if (rowErr) {
    return NextResponse.json({ error: rowErr.message }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ error: 'Tag row not found.' }, { status: 404 });
  }

  // Mirror RLS: non-admin can only modify locks they own.
  if (
    authz.user.role !== 'admin' &&
    row.locked_by !== null &&
    row.locked_by !== authz.user.id
  ) {
    return NextResponse.json(
      { error: 'Tag is locked by another user.' },
      { status: 403 },
    );
  }
  // Cannot lock to a different user.
  if (parsed.data.locked_by !== null && parsed.data.locked_by !== authz.user.id) {
    if (authz.user.role !== 'admin') {
      return NextResponse.json(
        { error: 'Reps may only lock tags as themselves.' },
        { status: 403 },
      );
    }
  }

  const update: Record<string, unknown> = {};
  if (parsed.data.locked_by === null) {
    update.locked_by = null;
    update.locked_at = null;
  } else {
    update.locked_by = parsed.data.locked_by;
    update.locked_at = new Date().toISOString();
  }

  const { data: updated, error: updErr } = await supabase
    .from('prospect_tags')
    .update(update)
    .eq('id', tagRowId)
    .select('id, prospect_id, tag_id, created_by, locked_by, locked_at')
    .maybeSingle();
  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }
  return NextResponse.json(updated, { status: 200 });
}
