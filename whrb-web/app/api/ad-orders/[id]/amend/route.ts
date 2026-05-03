import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/server/authz';
import { logEvent } from '@/lib/logging/server';
import { AmendSchema } from '@/lib/queries/ad-orders';

export const runtime = 'nodejs';

/**
 * POST /api/ad-orders/[id]/amend
 *
 * Admin-only. Wraps the `ad_order_amend` SQL RPC which is the only
 * sanctioned path through the paid-lockdown trigger. The RPC verifies
 * admin role server-side, sets the `app.amend_in_progress` GUC, applies
 * the typed UPDATE, and inserts an immutable ad_order_amendments row.
 *
 * Body:
 *   { field: string, new_value: string, reason: string }
 *
 * `new_value` is always a string from the wire — the RPC dispatches the
 * cast based on field. Empty string means NULL for nullable columns.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authz = await requireAdmin();
  if (authz.kind === 'unauth') return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });
  if (authz.kind === 'forbidden') return NextResponse.json({ error: 'Admin role required.' }, { status: 403 });

  const user = authz.user;
  const { id } = await params;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const parsed = AmendSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json(
      { error: `Invalid payload: ${issue.path.join('.') || '<root>'} — ${issue.message}` },
      { status: 400 },
    );
  }
  const body = parsed.data;
  const newValueText = body.new_value === null || body.new_value === undefined
    ? ''
    : String(body.new_value);

  const supabase = await createClient();
  const { error } = await supabase.rpc('ad_order_amend', {
    p_ad_order_id: id,
    p_field: body.field,
    p_new_value_text: newValueText,
    p_reason: body.reason,
  });

  if (error) {
    await logEvent({
      source: 'web_server',
      level: error.code === '42501' ? 'warn' : 'error',
      category: 'ad_order_amend_failed',
      message: 'ad_order_amend RPC failed',
      context: {
        id,
        field: body.field,
        code: error.code,
        message: error.message,
      },
      userId: user.id,
    });
    const status =
      error.code === '42501' ? 403 :
      error.code === '23503' ? 404 :
      error.code === '23505' ? 409 :
      error.code === '22023' ? 400 :
      error.code === '23514' ? 400 :
      400;
    return NextResponse.json({ error: error.message }, { status });
  }

  return NextResponse.json({ ok: true });
}
