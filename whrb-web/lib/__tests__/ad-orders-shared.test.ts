import { describe, expect, it } from 'vitest';

import {
  AdOrderCreateSchema,
  AdOrderPatchSchema,
  AmendSchema,
  MarkPaidSchema,
  OrgSettingsPatchSchema,
  formatUSD,
  semesterDateRange,
  semesterFor,
} from '@/lib/ad-orders/shared';

// ---------------------------------------------------------------------------
// promo_id normalization + format
// ---------------------------------------------------------------------------

describe('AdOrderCreateSchema — promo_id', () => {
  const baseValid = {
    company_name: 'Pro Arte',
    campaign_start: '2026-09-13',
    campaign_end: '2026-09-20',
    total_amount: 500,
  } as const;

  it('accepts canonical "PA 0925"', () => {
    const r = AdOrderCreateSchema.safeParse({ promo_id: 'PA 0925', ...baseValid });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.promo_id).toBe('PA 0925');
  });

  it('uppercases lowercase letters', () => {
    const r = AdOrderCreateSchema.safeParse({ promo_id: 'pa 0925', ...baseValid });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.promo_id).toBe('PA 0925');
  });

  it('collapses extra whitespace to single space', () => {
    const r = AdOrderCreateSchema.safeParse({ promo_id: '  pa   0925  ', ...baseValid });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.promo_id).toBe('PA 0925');
  });

  it('rejects malformed promo_ids', () => {
    for (const bad of ['PA0925', 'P 0925', 'PROMO 0925', 'PA 925', 'PA 09255', '0925 PA']) {
      const r = AdOrderCreateSchema.safeParse({ promo_id: bad, ...baseValid });
      expect(r.success, `expected '${bad}' to fail`).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Cross-field campaign window
// ---------------------------------------------------------------------------

describe('AdOrderCreateSchema — campaign window', () => {
  const baseValid = {
    promo_id: 'PA 0925',
    company_name: 'Pro Arte',
    total_amount: 500,
  } as const;

  it('accepts end == start (single-day flight)', () => {
    const r = AdOrderCreateSchema.safeParse({
      ...baseValid,
      campaign_start: '2026-09-13',
      campaign_end: '2026-09-13',
    });
    expect(r.success).toBe(true);
  });

  it('rejects end < start', () => {
    const r = AdOrderCreateSchema.safeParse({
      ...baseValid,
      campaign_start: '2026-09-20',
      campaign_end: '2026-09-13',
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0].path).toEqual(['campaign_end']);
    }
  });
});

describe('AdOrderPatchSchema — partial campaign window', () => {
  it('does not enforce ordering when only one of the dates is in the patch', () => {
    const r1 = AdOrderPatchSchema.safeParse({ campaign_start: '2026-12-01' });
    const r2 = AdOrderPatchSchema.safeParse({ campaign_end: '2026-01-01' });
    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
  });

  it('enforces ordering when both dates are in the patch', () => {
    const r = AdOrderPatchSchema.safeParse({
      campaign_start: '2026-12-01',
      campaign_end: '2026-01-01',
    });
    expect(r.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Money + percent validation
// ---------------------------------------------------------------------------

describe('money + percent validation', () => {
  const base = {
    promo_id: 'PA 0925',
    company_name: 'X',
    campaign_start: '2026-01-01',
    campaign_end: '2026-01-02',
  } as const;

  it('rejects negative totals', () => {
    expect(AdOrderCreateSchema.safeParse({ ...base, total_amount: -1 }).success).toBe(false);
  });

  it('rejects > 2 decimal places', () => {
    expect(AdOrderCreateSchema.safeParse({ ...base, total_amount: 100.005 }).success).toBe(false);
  });

  it('coerces numeric strings into numbers', () => {
    const r = AdOrderCreateSchema.safeParse({ ...base, total_amount: '500.00' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.total_amount).toBe(500);
  });

  it('rejects out-of-range commission and discount percents', () => {
    expect(
      AdOrderCreateSchema.safeParse({ ...base, total_amount: 100, commission_pct: 200 }).success,
    ).toBe(false);
    expect(
      AdOrderCreateSchema.safeParse({ ...base, total_amount: 100, discount_pct: -5 }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Mark paid + amend payload schemas
// ---------------------------------------------------------------------------

describe('MarkPaidSchema', () => {
  it('requires confirm_promo_id and client_check_number', () => {
    expect(MarkPaidSchema.safeParse({}).success).toBe(false);
    expect(MarkPaidSchema.safeParse({ confirm_promo_id: 'PA 0925' }).success).toBe(false);
    expect(
      MarkPaidSchema.safeParse({
        confirm_promo_id: 'PA 0925',
        client_check_number: '12345',
      }).success,
    ).toBe(true);
  });
});

describe('AmendSchema', () => {
  it('requires reason ≥ 5 chars', () => {
    expect(
      AmendSchema.safeParse({ field: 'total_amount', new_value: '100', reason: 'no' }).success,
    ).toBe(false);
    expect(
      AmendSchema.safeParse({ field: 'total_amount', new_value: '100', reason: 'typo fix' })
        .success,
    ).toBe(true);
  });
});

describe('OrgSettingsPatchSchema', () => {
  it('accepts a partial patch', () => {
    expect(OrgSettingsPatchSchema.safeParse({ default_commission_pct: 12.5 }).success).toBe(true);
    expect(OrgSettingsPatchSchema.safeParse({ default_invoice_net_days: 30 }).success).toBe(true);
    expect(OrgSettingsPatchSchema.safeParse({}).success).toBe(true);
  });

  it('rejects invalid values', () => {
    expect(OrgSettingsPatchSchema.safeParse({ default_invoice_net_days: -1 }).success).toBe(false);
    expect(OrgSettingsPatchSchema.safeParse({ default_invoice_net_days: 366 }).success).toBe(false);
    expect(OrgSettingsPatchSchema.safeParse({ default_commission_pct: 101 }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// semester helpers — must mirror public.whrb_semester(date) in SQL
// ---------------------------------------------------------------------------

describe('semesterFor', () => {
  it('classifies months', () => {
    expect(semesterFor(new Date(Date.UTC(2026, 0, 15)))).toBe('SP2026');   // Jan
    expect(semesterFor(new Date(Date.UTC(2026, 4, 15)))).toBe('SP2026');   // May
    expect(semesterFor(new Date(Date.UTC(2026, 5, 15)))).toBe('SU2026');   // Jun
    expect(semesterFor(new Date(Date.UTC(2026, 6, 15)))).toBe('SU2026');   // Jul
    expect(semesterFor(new Date(Date.UTC(2026, 7, 15)))).toBe('FA2026');   // Aug
    expect(semesterFor(new Date(Date.UTC(2026, 11, 15)))).toBe('FA2026');  // Dec
  });
});

describe('semesterDateRange', () => {
  it('round-trips known semesters', () => {
    expect(semesterDateRange('SP2026')).toEqual({ start: '2026-01-01', end: '2026-05-31' });
    expect(semesterDateRange('SU2026')).toEqual({ start: '2026-06-01', end: '2026-07-31' });
    expect(semesterDateRange('FA2026')).toEqual({ start: '2026-08-01', end: '2026-12-31' });
  });

  it('returns null for malformed strings', () => {
    expect(semesterDateRange('XX2026')).toBeNull();
    expect(semesterDateRange('SP26')).toBeNull();
    expect(semesterDateRange('')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// formatUSD
// ---------------------------------------------------------------------------

describe('formatUSD', () => {
  it('formats numeric strings', () => {
    expect(formatUSD('500')).toBe('$500.00');
    expect(formatUSD('1234.5')).toBe('$1,234.50');
    expect(formatUSD('0')).toBe('$0.00');
  });

  it('handles plain numbers', () => {
    expect(formatUSD(99.99)).toBe('$99.99');
  });

  it('returns "$—" for non-finite', () => {
    expect(formatUSD('not a number')).toBe('$—');
  });
});
