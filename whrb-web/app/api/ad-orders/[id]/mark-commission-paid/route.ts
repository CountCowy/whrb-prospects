import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/server/authz';
import { logEvent } from '@/lib/logging/server';
import { MarkCommissionPaidSchema, getAdOrder } from '@/lib/queries/ad-orders';

export const runtime = 'nodejs';

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
  const parsed = MarkCommissionPaidSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const existing = await getAdOrder(id);
  if (!existing) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  if (existing.archived_at) {
    return NextResponse.json(
      { error: 'Cannot mark commission paid on an archived order. Restore it first.' },
      { status: 409 },
    );
  }
  if (!existing.is_paid) {
    return NextResponse.json(
      { error: 'Cannot mark commission paid: row is not yet client-paid.' },
      { status: 400 },
    );
  }
  if (existing.commission_paid) {
    return NextResponse.json({ error: 'Commission already paid.' }, { status: 409 });
  }
  if (existing.promo_id !== parsed.data.confirm_promo_id.trim()) {
    return NextResponse.json(
      { error: 'Confirmation token mismatch (promo_id did not match).' },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from('ad_orders')
    .update({
      commission_paid: true,
      commission_paid_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (error) {
    await logEvent({
      source: 'web_server',
      level: error.code === '42501' ? 'warn' : 'error',
      category: 'ad_order_mark_comm_paid_failed',
      message: 'mark-commission-paid failed',
      context: { id, code: error.code, message: error.message },
      userId: user.id,
    });
    const status = error.code === '42501' ? 403 : 400;
    return NextResponse.json({ error: error.message }, { status });
  }
  return NextResponse.json({ ok: true });
}
