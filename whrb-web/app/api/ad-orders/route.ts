import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';
import { requireAdmin, getAuthed } from '@/lib/server/authz';
import { logEvent } from '@/lib/logging/server';
import {
  AD_ORDER_SORT_DIRS,
  AD_ORDER_SORT_FIELDS,
  AdOrderCreateSchema,
  DEFAULT_SORT,
  listAdOrders,
  getOrgSettings,
  type AdOrderListFilters,
  type AdOrderListSort,
} from '@/lib/queries/ad-orders';
import { syncAdOrderScheduleEvents } from '@/lib/server/ad-order-schedule';

export const runtime = 'nodejs';

// ---------------------------------------------------------------------------
// GET /api/ad-orders — list (RLS filters reps appropriately on read scope)
// ---------------------------------------------------------------------------
export async function GET(req: Request) {
  const authz = await getAuthed();
  if (authz.kind === 'unauth') {
    return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });
  }
  const url = new URL(req.url);
  const sp = url.searchParams;

  const filters: AdOrderListFilters = {};
  for (const k of [
    'q',
    'salesperson',
    'se_engineer',
    'paid',
    'commission_paid',
    'status',
    'semester',
    'start_after',
    'end_before',
    'archived',
  ] as const) {
    const v = sp.get(k);
    if (v) (filters as Record<string, string>)[k] = v;
  }

  const rawSort = sp.get('sort');
  const rawDir = sp.get('dir');
  const sortField: AdOrderListSort['field'] =
    rawSort && (AD_ORDER_SORT_FIELDS as readonly string[]).includes(rawSort)
      ? (rawSort as AdOrderListSort['field'])
      : DEFAULT_SORT.field;
  const sortDir: AdOrderListSort['dir'] =
    rawDir && (AD_ORDER_SORT_DIRS as readonly string[]).includes(rawDir)
      ? (rawDir as AdOrderListSort['dir'])
      : DEFAULT_SORT.dir;
  const sort: AdOrderListSort = { field: sortField, dir: sortDir };

  const page = Math.max(1, Number(sp.get('page') ?? 1));
  const pageSize = Math.min(250, Math.max(1, Number(sp.get('pageSize') ?? 50)));

  try {
    const result = await listAdOrders({ filters, sort, page, pageSize });
    return NextResponse.json(result);
  } catch (err) {
    await logEvent({
      source: 'web_server',
      level: 'error',
      category: 'api_exception',
      message: 'GET /api/ad-orders failed',
      context: { error: err instanceof Error ? err.message : String(err) },
      userId: authz.user.id,
    });
    return NextResponse.json({ error: 'List failed.' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST /api/ad-orders — admin-only create. Schedules linked schedule_events
// ---------------------------------------------------------------------------
export async function POST(req: Request) {
  const authz = await requireAdmin();
  if (authz.kind === 'unauth') {
    return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });
  }
  if (authz.kind === 'forbidden') {
    return NextResponse.json(
      { error: 'Only admins may create ad orders.' },
      { status: 403 },
    );
  }
  const user = authz.user;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const parsed = AdOrderCreateSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json(
      {
        error: `Invalid payload: ${issue.path.join('.') || '<root>'} — ${issue.message}`,
      },
      { status: 400 },
    );
  }
  const body = parsed.data;

  // Default commission_pct from org_settings if not provided. Reads via the
  // cookie client (RLS allows authed reads) — no need to elevate to service.
  let commissionPct = body.commission_pct;
  if (commissionPct === undefined) {
    const settings = await getOrgSettings();
    commissionPct = Number(settings.default_commission_pct);
  }

  const insert = {
    promo_id: body.promo_id,
    prospect_id: body.prospect_id ?? null,
    company_name: body.company_name.trim(),
    package_doc_url: body.package_doc_url ?? null,
    is_nonprofit_rate: body.is_nonprofit_rate ?? false,
    discount_pct: body.discount_pct ?? 0,
    payment_contact_name: body.payment_contact_name ?? null,
    payment_contact_email: body.payment_contact_email ?? null,
    campaign_start: body.campaign_start,
    campaign_end: body.campaign_end,
    total_amount: body.total_amount,
    salesperson_id: body.salesperson_id ?? null,
    commission_pct: commissionPct,
    se_engineer_id: body.se_engineer_id ?? null,
    notes: body.notes ?? null,
    // Schema's refine() guarantees these are consistent: false-with-null
    // or true-with-timestamp. Either path satisfies the DB CHECK.
    ad_produced: body.ad_produced ?? false,
    ad_produced_at: body.ad_produced_at ?? null,
    created_by: user.id,
  };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('ad_orders')
    .insert(insert)
    .select('id, promo_id, company_name, prospect_id, campaign_start')
    .single();

  if (error) {
    await logEvent({
      source: 'web_server',
      level: 'error',
      category: 'ad_order_insert_failed',
      message: 'failed to insert ad_order',
      context: { code: error.code, message: error.message, promo_id: body.promo_id },
      userId: user.id,
    });
    const status = error.code === '23505' ? 409 : 400;
    return NextResponse.json({ error: error.message }, { status });
  }

  // Best-effort schedule sync (does not block on failure).
  await syncAdOrderScheduleEvents({
    adOrderId: data.id,
    promoId: data.promo_id,
    companyName: data.company_name,
    campaignStart: data.campaign_start,
    prospectId: data.prospect_id ?? null,
    actorId: user.id,
  });

  return NextResponse.json({ id: data.id, promo_id: data.promo_id }, { status: 201 });
}
