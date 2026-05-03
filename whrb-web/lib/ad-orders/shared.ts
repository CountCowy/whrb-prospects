// Shared (non-server) schemas + pure helpers for the ad_orders feature.
// This module deliberately avoids `import 'server-only'` so it can be loaded
// from Vitest specs and from client components alike.

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const AD_ORDER_STATUSES = [
  'pending_production',
  'awaiting_invoice',
  'awaiting_payment',
  'awaiting_commission',
  'closed',
  'archived',
] as const;
export type AdOrderStatus = (typeof AD_ORDER_STATUSES)[number];

export const PAGE_SIZES = [25, 50, 100, 250] as const;
export const DEFAULT_PAGE_SIZE = 50;

export type AdOrderListFilters = {
  q?: string;
  salesperson?: string;
  se_engineer?: string;
  paid?: 'true' | 'false';
  commission_paid?: 'true' | 'false';
  status?: AdOrderStatus;
  semester?: string;
  start_after?: string;
  end_before?: string;
  archived?: 'true' | 'false';
};

export const AD_ORDER_SORT_FIELDS = [
  'campaign_start',
  'campaign_end',
  'total_amount',
  'created_at',
  'promo_id',
] as const;
export const AD_ORDER_SORT_DIRS = ['asc', 'desc'] as const;

export type AdOrderListSort = {
  field: (typeof AD_ORDER_SORT_FIELDS)[number];
  dir: (typeof AD_ORDER_SORT_DIRS)[number];
};

export const DEFAULT_SORT: AdOrderListSort = { field: 'campaign_start', dir: 'desc' };

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const PROMO_ID_RE = /^[A-Z]{2,4} \d{4}$/;
const GOOGLE_DOC_RE = /^https:\/\/(docs|drive)\.google\.com\//;

const moneyAmount = z.preprocess(
  (v) => (typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : v),
  z.number().nonnegative().multipleOf(0.01),
);

const percent = z.preprocess(
  (v) => (typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : v),
  z.number().min(0).max(100).multipleOf(0.01),
);

const promoIdInput = z
  .string()
  .transform((s) => s.toUpperCase().replace(/\s+/g, ' ').trim())
  .refine((s) => PROMO_ID_RE.test(s), {
    message: 'promo_id must look like "PA 0925" (2-4 letters, space, 4 digits)',
  });

const isoDate = z
  .string()
  .refine((s) => /^\d{4}-\d{2}-\d{2}$/.test(s), 'expected YYYY-MM-DD');

const optionalEmail = z.string().email().optional().or(z.literal('').transform(() => undefined));

const optionalGoogleDocUrl = z
  .string()
  .url()
  .refine((u) => GOOGLE_DOC_RE.test(u), 'expected a docs.google.com or drive.google.com URL')
  .optional()
  .or(z.literal('').transform(() => undefined));

export const AdOrderCreateSchema = z
  .object({
    promo_id: promoIdInput,
    prospect_id: z.string().uuid().optional(),
    company_name: z.string().min(1).max(300),
    package_doc_url: optionalGoogleDocUrl,
    is_nonprofit_rate: z.boolean().optional().default(false),
    discount_pct: percent.optional().default(0),
    payment_contact_name: z.string().max(200).optional(),
    payment_contact_email: optionalEmail,
    campaign_start: isoDate,
    campaign_end: isoDate,
    total_amount: moneyAmount,
    salesperson_id: z.string().uuid().optional(),
    commission_pct: percent.optional(),
    se_engineer_id: z.string().uuid().optional(),
    notes: z.string().max(5000).optional(),
  })
  .refine((data) => data.campaign_end >= data.campaign_start, {
    message: 'campaign_end must be on or after campaign_start',
    path: ['campaign_end'],
  });

export type AdOrderCreateInput = z.infer<typeof AdOrderCreateSchema>;

export const AdOrderPatchSchema = z
  .object({
    promo_id: promoIdInput.optional(),
    prospect_id: z.string().uuid().nullable().optional(),
    company_name: z.string().min(1).max(300).optional(),
    package_doc_url: optionalGoogleDocUrl.nullable(),
    is_nonprofit_rate: z.boolean().optional(),
    discount_pct: percent.optional(),
    payment_contact_name: z.string().max(200).nullable().optional(),
    payment_contact_email: optionalEmail.nullable(),
    campaign_start: isoDate.optional(),
    campaign_end: isoDate.optional(),
    total_amount: moneyAmount.optional(),
    salesperson_id: z.string().uuid().nullable().optional(),
    commission_pct: percent.optional(),
    ad_produced: z.boolean().optional(),
    ad_produced_at: z.string().datetime().nullable().optional(),
    se_engineer_id: z.string().uuid().nullable().optional(),
    invoice_number: z.string().max(50).nullable().optional(),
    invoice_sent_at: isoDate.nullable().optional(),
    notes: z.string().max(5000).nullable().optional(),
  })
  .refine(
    (d) =>
      d.campaign_start === undefined ||
      d.campaign_end === undefined ||
      d.campaign_end >= d.campaign_start,
    { message: 'campaign_end must be on or after campaign_start', path: ['campaign_end'] },
  );

export type AdOrderPatchInput = z.infer<typeof AdOrderPatchSchema>;

export const MarkPaidSchema = z.object({
  client_check_number: z.string().min(1).max(50),
  invoice_number: z.string().min(1).max(50).optional(),
  confirm_promo_id: z.string(),
});
export type MarkPaidInput = z.infer<typeof MarkPaidSchema>;

export const MarkCommissionPaidSchema = z.object({
  confirm_promo_id: z.string(),
});
export type MarkCommissionPaidInput = z.infer<typeof MarkCommissionPaidSchema>;

export const AmendSchema = z.object({
  field: z.string().min(1).max(64),
  new_value: z.unknown(),
  reason: z.string().min(5).max(1000),
});
export type AmendInput = z.infer<typeof AmendSchema>;

export const OrgSettingsPatchSchema = z.object({
  default_commission_pct: percent.optional(),
  default_invoice_net_days: z.number().int().min(0).max(365).optional(),
});
export type OrgSettingsPatchInput = z.infer<typeof OrgSettingsPatchSchema>;

// ---------------------------------------------------------------------------
// Pure helpers (no I/O)
// ---------------------------------------------------------------------------

/** Mirror of public.whrb_semester(date) — returns 'FA2025' / 'SP2026' / 'SU2025'. */
export function semesterFor(date: Date): string {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  if (m >= 1 && m <= 5) return `SP${y}`;
  if (m >= 6 && m <= 7) return `SU${y}`;
  return `FA${y}`;
}

/** Inverse: ISO date bounds for a semester string. Returns null if malformed. */
export function semesterDateRange(
  semester: string,
): { start: string; end: string } | null {
  const m = /^(SP|SU|FA)(\d{4})$/.exec(semester);
  if (!m) return null;
  const year = Number(m[2]);
  switch (m[1]) {
    case 'SP':
      return { start: `${year}-01-01`, end: `${year}-05-31` };
    case 'SU':
      return { start: `${year}-06-01`, end: `${year}-07-31` };
    case 'FA':
      return { start: `${year}-08-01`, end: `${year}-12-31` };
    default:
      return null;
  }
}

/** Cents-safe currency display for our scale (numeric(12,2)). */
export function formatUSD(amount: string | number): string {
  const n = typeof amount === 'number' ? amount : Number(amount);
  if (!Number.isFinite(n)) return '$—';
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
