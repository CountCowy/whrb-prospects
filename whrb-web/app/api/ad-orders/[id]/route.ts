import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';
import { getAuthed } from '@/lib/server/authz';
import { logEvent } from '@/lib/logging/server';
import {
  AdOrderPatchSchema,
  getAdOrder,
} from '@/lib/queries/ad-orders';
import { syncAdOrderScheduleEvents } from '@/lib/server/ad-order-schedule';

export const runtime = 'nodejs';

// GET /api/ad-orders/[id] — detail (RLS-filtered).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authz = await getAuthed();
  if (authz.kind === 'unauth') {
    return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });
  }
  const { id } = await params;
  try {
    const row = await getAdOrder(id);
    if (!row) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
    return NextResponse.json({ row });
  } catch (err) {
    await logEvent({
      source: 'web_server',
      level: 'error',
      category: 'api_exception',
      message: 'GET /api/ad-orders/[id] failed',
      context: { id, error: err instanceof Error ? err.message : String(err) },
      userId: authz.user.id,
    });
    return NextResponse.json({ error: 'Detail failed.' }, { status: 500 });
  }
}

// PATCH /api/ad-orders/[id] — field edits. Column-guard + paid-lockdown
// triggers do the per-field auth and immutability checks at the DB layer.
// PostgREST surfaces 42501 as a 403 with the trigger's error message.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authz = await getAuthed();
  if (authz.kind === 'unauth') {
    return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });
  }
  const { id } = await params;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const parsed = AdOrderPatchSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json(
      { error: `Invalid payload: ${issue.path.join('.') || '<root>'} — ${issue.message}` },
      { status: 400 },
    );
  }
  const patch = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('ad_orders')
    .update(patch)
    .eq('id', id)
    .select('id, promo_id, company_name, prospect_id, campaign_start')
    .maybeSingle();

  if (error) {
    await logEvent({
      source: 'web_server',
      level: error.code === '42501' ? 'warn' : 'error',
      category: 'ad_order_patch_failed',
      message: 'PATCH /api/ad-orders/[id] failed',
      context: { id, code: error.code, message: error.message },
      userId: authz.user.id,
    });
    const status =
      error.code === '42501' ? 403 :
      error.code === '23505' ? 409 :
      error.code === '23514' ? 400 :   // CHECK constraint
      400;
    return NextResponse.json({ error: error.message }, { status });
  }
  if (!data) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }

  // If campaign_start moved, refresh the linked schedule_events.
  if (patch.campaign_start) {
    await syncAdOrderScheduleEvents({
      adOrderId: data.id,
      promoId: data.promo_id,
      companyName: data.company_name,
      campaignStart: data.campaign_start,
      prospectId: data.prospect_id ?? null,
      actorId: authz.user.id,
    });
  }

  return NextResponse.json({ ok: true, id: data.id });
}
