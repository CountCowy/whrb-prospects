import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getAuthed } from '@/lib/server/authz';
import { logEvent } from '@/lib/logging/server';

export const runtime = 'nodejs';

// Fields that never move through this route regardless of role. Managed by
// the pipeline or the trigger layer.
const IMMUTABLE = new Set([
  'id',
  'business_key',
  'created_at',
  'created_source',
  'updated_at',
  'pipeline_last_seen_at',
  'alt_fields',
  'pipeline_notes',
  'assigned_at',
]);

// Fields that are user-editable through the detail page. Non-admin
// non-assignee users are blocked at the API layer (and by the DB trigger).
// `contact_email` is intentionally NOT in this set — it is now managed
// via the multi-email API at /api/prospects/[id]/contact-emails (010).
const EDITABLE = new Set([
  'tier',
  'company_name',
  'company_phone',
  'company_email',
  'contact_name',
  'contact_phone',
  'contact_title',
  'contact_linkedin',
  'sales_email',
  'website',
  'address',
  'zip',
  'category',
  'state',
  'is_nonprofit',
  'nonprofit_source',
  'ein',
  'priority_score',
  'rating',
  'review_count',
  'seasonality_window',
  'source',
]);

// Fields whose edit counts as a lock (records into user_overrides).
// `contact_email` was removed in 010 — the new pipeline-skip-if-any-email
// gate (whrb-prospects/db/supabase_sync.py) provides equivalent
// protection, and the per-field lock semantics no longer fit a child
// table where reps add/delete rows individually.
const LOCK_ON_EDIT = new Set([
  'tier',
  'company_name',
  'company_phone',
  'company_email',
  'contact_name',
  'contact_phone',
  'website',
  'address',
  'zip',
  'category',
  'is_nonprofit',
  'nonprofit_source',
  'ein',
  'priority_score',
]);

const PatchBody = z.object({
  patch: z.record(z.string(), z.unknown()).optional(),
  unlock: z.string().optional(),
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
  const parsed = PatchBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid payload: must include { patch } or { unlock }.' },
      { status: 400 },
    );
  }
  const { patch, unlock } = parsed.data;
  if (!patch && !unlock) {
    return NextResponse.json(
      { error: 'Provide either { patch } or { unlock }.' },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const { data: row, error: loadErr } = await supabase
    .from('prospects')
    .select('id,assigned_to,user_overrides')
    .eq('id', id)
    .maybeSingle();
  if (loadErr || !row) {
    return NextResponse.json(
      { error: loadErr?.message ?? 'Prospect not found.' },
      { status: 404 },
    );
  }

  const isAdmin = user.role === 'admin';
  const isAssignee = row.assigned_to === user.id;
  if (!isAdmin && !isAssignee) {
    return NextResponse.json(
      { error: 'Only the assignee or an admin may edit this prospect.' },
      { status: 403 },
    );
  }

  const overrides: Record<string, unknown> = {
    ...((row.user_overrides as Record<string, unknown>) ?? {}),
  };
  const update: Record<string, unknown> = {};

  if (patch) {
    for (const [key, value] of Object.entries(patch)) {
      if (IMMUTABLE.has(key)) {
        return NextResponse.json(
          { error: `Field "${key}" is not editable via this endpoint.` },
          { status: 400 },
        );
      }
      if (!EDITABLE.has(key)) {
        return NextResponse.json(
          { error: `Unknown field "${key}".` },
          { status: 400 },
        );
      }
      update[key] = value;
      if (LOCK_ON_EDIT.has(key)) overrides[key] = true;
      // is_nonprofit is a composite lock: editing it also locks nonprofit_source + ein.
      if (key === 'is_nonprofit') {
        overrides['nonprofit_source'] = true;
        overrides['ein'] = true;
      }
    }
  }

  if (unlock) {
    if (unlock === 'contact_email') {
      return NextResponse.json(
        {
          error:
            'contact_email is no longer field-locked; manage emails via /api/prospects/[id]/contact-emails.',
        },
        { status: 400 },
      );
    }
    if (!(unlock in overrides)) {
      return NextResponse.json(
        { error: `Field "${unlock}" is not currently locked.` },
        { status: 400 },
      );
    }
    delete overrides[unlock];
    if (unlock === 'is_nonprofit') {
      delete overrides['nonprofit_source'];
      delete overrides['ein'];
    }
  }

  update['user_overrides'] = overrides;

  const { error: updErr } = await supabase
    .from('prospects')
    .update(update)
    .eq('id', id);
  if (updErr) {
    // The DB guard trigger uses SQLSTATE 42501 → PostgREST translates.
    const status = updErr.code === '42501' || updErr.code === 'PGRST116' ? 403 : 500;
    await logEvent({
      source: 'web_server',
      level: 'error',
      category: 'api_exception',
      message: 'prospect patch failed',
      context: { code: updErr.code, message: updErr.message, id },
      userId: user.id,
    });
    return NextResponse.json({ error: updErr.message }, { status });
  }

  return NextResponse.json({ ok: true, id });
}
