import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/server/authz';
import { logEvent } from '@/lib/logging/server';
import { MarkPaidSchema, getAdOrder } from '@/lib/queries/ad-orders';

export const runtime = 'nodejs';

/**
 * POST /api/ad-orders/[id]/mark-paid
 *
 * Admin-only. Sets is_paid=true, paid_at=now(), client_check_number, and
 * (optionally) invoice_number if not already set. Requires the request
 * body to echo the row's promo_id as a confirmation token to defeat
 * accidental clicks.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authz = await requireAdmin();
  if (authz.kind === 'unauth') {
    return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });
  }
  if (authz.kind === 'forbidden') {
    return NextResponse.json({ error: 'Admin role required.' }, { status: 403 });
  }
  const user = authz.user;
  const { id } = await params;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }
  const parsed = MarkPaidSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json(
      { error: `Invalid payload: ${issue.path.join('.') || '<root>'} — ${issue.message}` },
      { status: 400 },
    );
  }
  const body = parsed.data;

  const existing = await getAdOrder(id);
  if (!existing) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  if (existing.archived_at) {
    return NextResponse.json(
      { error: 'Cannot mark paid on an archived order. Restore it first.' },
      { status: 409 },
    );
  }
  if (existing.is_paid) {
    return NextResponse.json({ error: 'Already paid.' }, { status: 409 });
  }
  if (existing.promo_id !== body.confirm_promo_id.trim()) {
    return NextResponse.json(
      { error: 'Confirmation token mismatch (promo_id did not match).' },
      { status: 400 },
    );
  }

  // Ensure invoice_sent_at is satisfied. Either it's already set, or the
  // body provides invoice_number and we stamp invoice_sent_at = today.
  const update: Record<string, unknown> = {
    is_paid: true,
    paid_at: new Date().toISOString(),
    client_check_number: body.client_check_number,
  };
  if (!existing.invoice_sent_at) {
    if (!body.invoice_number) {
      return NextResponse.json(
        {
          error:
            'Cannot mark paid: no invoice_sent_at on row, and no invoice_number provided to set it.',
        },
        { status: 400 },
      );
    }
    update.invoice_number = body.invoice_number;
    update.invoice_sent_at = new Date().toISOString().slice(0, 10);
  } else if (body.invoice_number) {
    update.invoice_number = body.invoice_number;
  }

  const supabase = await createClient();
  const { error } = await supabase.from('ad_orders').update(update).eq('id', id);
  if (error) {
    await logEvent({
      source: 'web_server',
      level: error.code === '42501' ? 'warn' : 'error',
      category: 'ad_order_mark_paid_failed',
      message: 'mark-paid failed',
      context: { id, code: error.code, message: error.message },
      userId: user.id,
    });
    const status =
      error.code === '42501' ? 403 :
      error.code === '23505' ? 409 :
      400;
    return NextResponse.json({ error: error.message }, { status });
  }

  return NextResponse.json({ ok: true });
}
