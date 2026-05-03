import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import {
  type AdOrderListFilters,
  type AdOrderListSort,
  DEFAULT_PAGE_SIZE,
  DEFAULT_SORT,
  semesterDateRange,
} from '@/lib/ad-orders/shared';

// Re-export shared types & schemas so existing imports from
// `@/lib/queries/ad-orders` keep working.
export {
  AD_ORDER_STATUSES,
  AdOrderCreateSchema,
  AdOrderPatchSchema,
  AmendSchema,
  DEFAULT_PAGE_SIZE,
  DEFAULT_SORT,
  MarkCommissionPaidSchema,
  MarkPaidSchema,
  OrgSettingsPatchSchema,
  PAGE_SIZES,
  formatUSD,
  semesterDateRange,
  semesterFor,
} from '@/lib/ad-orders/shared';
export type {
  AdOrderCreateInput,
  AdOrderListFilters,
  AdOrderListSort,
  AdOrderPatchInput,
  AdOrderStatus,
  AmendInput,
  MarkCommissionPaidInput,
  MarkPaidInput,
  OrgSettingsPatchInput,
} from '@/lib/ad-orders/shared';

// ---------------------------------------------------------------------------
// Server-only types
// ---------------------------------------------------------------------------

/** Money fields are returned by PostgREST as strings to preserve precision. */
export type AdOrderRow = {
  id: string;
  promo_id: string;
  prospect_id: string | null;
  company_name: string;
  package_doc_url: string | null;
  is_nonprofit_rate: boolean;
  discount_pct: string;
  payment_contact_name: string | null;
  payment_contact_email: string | null;
  campaign_start: string;
  campaign_end: string;
  total_amount: string;
  salesperson_id: string | null;
  commission_pct: string;
  ad_produced: boolean;
  ad_produced_at: string | null;
  se_engineer_id: string | null;
  invoice_number: string | null;
  invoice_sent_at: string | null;
  is_paid: boolean;
  paid_at: string | null;
  client_check_number: string | null;
  commission_amount: string;
  commission_paid: boolean;
  commission_paid_at: string | null;
  notes: string | null;
  archived_at: string | null;
  archived_by: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  salesperson?: ProfileLite | null;
  se_engineer?: ProfileLite | null;
  prospect?: { id: string; company_name: string } | null;
};

export type ProfileLite = {
  id: string;
  email: string;
  display_name: string | null;
};

const SEARCH_FIELDS = [
  'promo_id',
  'company_name',
  'payment_contact_name',
  'payment_contact_email',
  'invoice_number',
  'client_check_number',
  'notes',
];

const SELECT_BASE = `
  *,
  salesperson:profiles!salesperson_id(id,email,display_name),
  se_engineer:profiles!se_engineer_id(id,email,display_name),
  prospect:prospects!prospect_id(id,company_name)
`;

export type AdOrderListResult = {
  rows: AdOrderRow[];
  total: number;
  page: number;
  pageSize: number;
  sort: AdOrderListSort;
  filters: AdOrderListFilters;
};

// ---------------------------------------------------------------------------
// Server-side query helpers (cookie-aware client honors RLS)
// ---------------------------------------------------------------------------

export async function listAdOrders(params: {
  filters?: AdOrderListFilters;
  sort?: AdOrderListSort;
  page?: number;
  pageSize?: number;
}): Promise<AdOrderListResult> {
  const supabase = await createClient();
  const filters = params.filters ?? {};
  const sort = params.sort ?? DEFAULT_SORT;
  const page = Math.max(1, params.page ?? 1);
  const pageSize = params.pageSize ?? DEFAULT_PAGE_SIZE;

  let query = supabase.from('ad_orders').select(SELECT_BASE, { count: 'exact' });

  if (filters.archived === 'true') {
    query = query.not('archived_at', 'is', null);
  } else {
    query = query.is('archived_at', null);
  }

  if (filters.q && filters.q.trim()) {
    const term = filters.q.trim().replace(/[%_]/g, '');
    const orClause = SEARCH_FIELDS.map((f) => `${f}.ilike.%${term}%`).join(',');
    query = query.or(orClause);
  }

  if (filters.salesperson) query = query.eq('salesperson_id', filters.salesperson);
  if (filters.se_engineer) query = query.eq('se_engineer_id', filters.se_engineer);
  if (filters.paid === 'true') query = query.eq('is_paid', true);
  if (filters.paid === 'false') query = query.eq('is_paid', false);
  if (filters.commission_paid === 'true') query = query.eq('commission_paid', true);
  if (filters.commission_paid === 'false') query = query.eq('commission_paid', false);
  if (filters.start_after) query = query.gte('campaign_start', filters.start_after);
  if (filters.end_before) query = query.lte('campaign_end', filters.end_before);

  if (filters.semester) {
    const range = semesterDateRange(filters.semester);
    if (range) {
      query = query.gte('campaign_start', range.start).lte('campaign_start', range.end);
    }
  }

  query = query.order(sort.field, { ascending: sort.dir === 'asc' });
  const from = (page - 1) * pageSize;
  query = query.range(from, from + pageSize - 1);

  const { data, count, error } = await query;
  if (error) {
    throw new Error(`listAdOrders failed: ${error.message}`);
  }

  return {
    rows: (data ?? []) as unknown as AdOrderRow[],
    total: count ?? 0,
    page,
    pageSize,
    sort,
    filters,
  };
}

export async function getAdOrder(id: string): Promise<AdOrderRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('ad_orders')
    .select(SELECT_BASE)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`getAdOrder failed: ${error.message}`);
  return (data as unknown as AdOrderRow) ?? null;
}

export type AdOrderAmendment = {
  id: string;
  ad_order_id: string;
  field: string;
  old_value: unknown;
  new_value: unknown;
  reason: string;
  amended_by: string;
  amended_at: string;
  amender?: ProfileLite | null;
};

export async function listAmendments(adOrderId: string): Promise<AdOrderAmendment[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('ad_order_amendments')
    .select('*, amender:profiles!amended_by(id,email,display_name)')
    .eq('ad_order_id', adOrderId)
    .order('amended_at', { ascending: false });
  if (error) throw new Error(`listAmendments failed: ${error.message}`);
  return (data ?? []) as unknown as AdOrderAmendment[];
}

export type AdOrderActivity = {
  id: string;
  category: string;
  message: string;
  context: Record<string, unknown>;
  user_id: string | null;
  created_at: string;
};

export async function listActivity(adOrderId: string): Promise<AdOrderActivity[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('event_log')
    .select('id,category,message,context,user_id,created_at')
    .like('category', 'ad_order_%')
    .contains('context', { ad_order_id: adOrderId })
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw new Error(`listActivity failed: ${error.message}`);
  return (data ?? []) as unknown as AdOrderActivity[];
}

// ---------------------------------------------------------------------------
// org_settings helpers
// ---------------------------------------------------------------------------

export type OrgSettings = {
  default_commission_pct: string;
  default_invoice_net_days: number;
  updated_at: string;
  updated_by: string | null;
};

export async function getOrgSettings(): Promise<OrgSettings> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('org_settings')
    .select('default_commission_pct,default_invoice_net_days,updated_at,updated_by')
    .single();
  if (error) throw new Error(`getOrgSettings failed: ${error.message}`);
  return data as OrgSettings;
}

export async function getOrgSettingsService(): Promise<OrgSettings> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('org_settings')
    .select('default_commission_pct,default_invoice_net_days,updated_at,updated_by')
    .single();
  if (error) throw new Error(`getOrgSettingsService failed: ${error.message}`);
  return data as OrgSettings;
}
