'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { AdOrderRow } from '@/lib/queries/ad-orders';

type Props =
  | {
      mode: 'create';
      defaultCommissionPct: number;
    }
  | {
      mode: 'edit';
      row: AdOrderRow;
      isAdmin: boolean;
      isLocked: boolean;
    };

type FieldState = {
  promo_id: string;
  prospect_id: string;
  company_name: string;
  package_doc_url: string;
  is_nonprofit_rate: boolean;
  discount_pct: string;
  payment_contact_name: string;
  payment_contact_email: string;
  campaign_start: string;
  campaign_end: string;
  total_amount: string;
  salesperson_id: string;
  commission_pct: string;
  ad_produced: boolean;
  se_engineer_id: string;
  notes: string;
};

function initialFromRow(row: AdOrderRow): FieldState {
  return {
    promo_id: row.promo_id,
    prospect_id: row.prospect_id ?? '',
    company_name: row.company_name,
    package_doc_url: row.package_doc_url ?? '',
    is_nonprofit_rate: row.is_nonprofit_rate,
    discount_pct: String(row.discount_pct ?? '0'),
    payment_contact_name: row.payment_contact_name ?? '',
    payment_contact_email: row.payment_contact_email ?? '',
    campaign_start: row.campaign_start,
    campaign_end: row.campaign_end,
    total_amount: String(row.total_amount ?? '0'),
    salesperson_id: row.salesperson_id ?? '',
    commission_pct: String(row.commission_pct ?? '0'),
    ad_produced: row.ad_produced,
    se_engineer_id: row.se_engineer_id ?? '',
    notes: row.notes ?? '',
  };
}

function emptyState(defaultCommissionPct: number): FieldState {
  return {
    promo_id: '',
    prospect_id: '',
    company_name: '',
    package_doc_url: '',
    is_nonprofit_rate: false,
    discount_pct: '0',
    payment_contact_name: '',
    payment_contact_email: '',
    campaign_start: '',
    campaign_end: '',
    total_amount: '',
    salesperson_id: '',
    commission_pct: String(defaultCommissionPct),
    ad_produced: false,
    se_engineer_id: '',
    notes: '',
  };
}

export function AdOrderForm(props: Props) {
  const router = useRouter();
  const initial =
    props.mode === 'create'
      ? emptyState(props.defaultCommissionPct)
      : initialFromRow(props.row);
  const [s, setS] = useState<FieldState>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState<Set<string>>(new Set());

  const isEdit = props.mode === 'edit';
  const lockedAfterPaid = isEdit && props.isLocked;

  function set<K extends keyof FieldState>(key: K, value: FieldState[K]) {
    setS((prev) => ({ ...prev, [key]: value }));
    setTouched((prev) => new Set(prev).add(key as string));
  }

  function onlyChanged(): Partial<FieldState> {
    if (props.mode === 'create') return s;
    const out: Record<string, unknown> = {};
    for (const k of touched) {
      const v = (s as Record<string, unknown>)[k];
      // Coerce empty strings to null for nullable fields.
      out[k] = v === '' && k !== 'company_name' && k !== 'promo_id' ? null : v;
    }
    return out as Partial<FieldState>;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (props.mode === 'create') {
        const payload = {
          ...s,
          discount_pct: Number(s.discount_pct),
          commission_pct: Number(s.commission_pct),
          total_amount: Number(s.total_amount),
          // Strip empty strings to undefined so optionals work.
          prospect_id: s.prospect_id || undefined,
          package_doc_url: s.package_doc_url || undefined,
          payment_contact_name: s.payment_contact_name || undefined,
          payment_contact_email: s.payment_contact_email || undefined,
          salesperson_id: s.salesperson_id || undefined,
          se_engineer_id: s.se_engineer_id || undefined,
          notes: s.notes || undefined,
        };
        const r = await fetch('/api/ad-orders', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
        router.push(`/ad-orders/${body.id}`);
      } else {
        const changes = onlyChanged();
        if (Object.keys(changes).length === 0) {
          setError('Nothing to save.');
          setBusy(false);
          return;
        }
        // Coerce numeric/percent-like strings to numbers if changed.
        const c = changes as Record<string, unknown>;
        for (const numKey of ['discount_pct', 'commission_pct', 'total_amount']) {
          if (c[numKey] !== undefined) c[numKey] = Number(c[numKey]);
        }
        const r = await fetch(`/api/ad-orders/${props.row.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(c),
        });
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
        router.refresh();
        setTouched(new Set());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  // Disable any field that is admin-only when current viewer isn't an admin
  // OR that is locked after paid (mainly applies in edit mode).
  function disabledFor(field: keyof FieldState): boolean {
    if (props.mode === 'create') return busy;
    if (busy) return true;
    if (!props.isAdmin) {
      // Reps may not edit admin-only / money / attribution fields directly.
      const adminOnly: (keyof FieldState)[] = [
        'promo_id',
        'prospect_id',
        'company_name',
        'commission_pct',
        'salesperson_id',
        'se_engineer_id',
      ];
      if (adminOnly.includes(field)) return true;
    }
    if (lockedAfterPaid) {
      // After paid, only notes are editable through the regular PATCH.
      // Everything else must use the Amend flow.
      const stillEditable: (keyof FieldState)[] = ['notes'];
      if (!stillEditable.includes(field)) return true;
    }
    return false;
  }

  return (
    <form onSubmit={submit} className="space-y-6 rounded-lg border bg-card p-6">
      {error && (
        <div className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-900 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-200">
          {error}
        </div>
      )}
      {lockedAfterPaid && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          🔒 This row is locked because it has been marked paid. Use the
          <strong className="mx-1">Amend</strong> flow to change financial fields.
        </div>
      )}

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <Label htmlFor="promo_id">Promo ID *</Label>
          <Input
            id="promo_id"
            placeholder="PA 0925"
            value={s.promo_id}
            disabled={disabledFor('promo_id')}
            onChange={(e) => set('promo_id', e.target.value)}
            required
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Format: 2-4 uppercase letters, space, 4 digits (e.g. PA 0925).
          </p>
        </div>
        <div>
          <Label htmlFor="company_name">Company *</Label>
          <Input
            id="company_name"
            value={s.company_name}
            disabled={disabledFor('company_name')}
            onChange={(e) => set('company_name', e.target.value)}
            required
          />
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <Label htmlFor="package_doc_url">Package details (Google Doc URL)</Label>
          <Input
            id="package_doc_url"
            type="url"
            placeholder="https://docs.google.com/document/d/…"
            value={s.package_doc_url}
            disabled={disabledFor('package_doc_url')}
            onChange={(e) => set('package_doc_url', e.target.value)}
          />
        </div>
        <div className="flex items-end gap-3">
          <div>
            <Label htmlFor="discount_pct">Discount %</Label>
            <Input
              id="discount_pct"
              type="number"
              step="0.01"
              min="0"
              max="100"
              value={s.discount_pct}
              disabled={disabledFor('discount_pct')}
              onChange={(e) => set('discount_pct', e.target.value)}
            />
          </div>
          <label className="mb-2 flex items-center gap-2 text-sm">
            <Checkbox
              id="is_nonprofit_rate"
              checked={s.is_nonprofit_rate}
              disabled={disabledFor('is_nonprofit_rate')}
              onCheckedChange={(c) => set('is_nonprofit_rate', Boolean(c))}
            />
            <span>Non-profit rate</span>
          </label>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <Label htmlFor="payment_contact_name">Payment contact</Label>
          <Input
            id="payment_contact_name"
            value={s.payment_contact_name}
            disabled={disabledFor('payment_contact_name')}
            onChange={(e) => set('payment_contact_name', e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="payment_contact_email">Email address</Label>
          <Input
            id="payment_contact_email"
            type="email"
            value={s.payment_contact_email}
            disabled={disabledFor('payment_contact_email')}
            onChange={(e) => set('payment_contact_email', e.target.value)}
          />
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div>
          <Label htmlFor="campaign_start">Campaign start *</Label>
          <Input
            id="campaign_start"
            type="date"
            value={s.campaign_start}
            disabled={disabledFor('campaign_start')}
            onChange={(e) => set('campaign_start', e.target.value)}
            required
          />
        </div>
        <div>
          <Label htmlFor="campaign_end">Campaign end *</Label>
          <Input
            id="campaign_end"
            type="date"
            value={s.campaign_end}
            disabled={disabledFor('campaign_end')}
            onChange={(e) => set('campaign_end', e.target.value)}
            required
          />
        </div>
        <div>
          <Label htmlFor="total_amount">Total ($) *</Label>
          <Input
            id="total_amount"
            type="number"
            step="0.01"
            min="0"
            value={s.total_amount}
            disabled={disabledFor('total_amount')}
            onChange={(e) => set('total_amount', e.target.value)}
            required
          />
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div>
          <Label htmlFor="salesperson_id">Salesperson (profile UUID)</Label>
          <Input
            id="salesperson_id"
            placeholder="uuid"
            value={s.salesperson_id}
            disabled={disabledFor('salesperson_id')}
            onChange={(e) => set('salesperson_id', e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="se_engineer_id">SE engineer (profile UUID)</Label>
          <Input
            id="se_engineer_id"
            placeholder="uuid"
            value={s.se_engineer_id}
            disabled={disabledFor('se_engineer_id')}
            onChange={(e) => set('se_engineer_id', e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="commission_pct">Commission %</Label>
          <Input
            id="commission_pct"
            type="number"
            step="0.01"
            min="0"
            max="100"
            value={s.commission_pct}
            disabled={disabledFor('commission_pct')}
            onChange={(e) => set('commission_pct', e.target.value)}
          />
        </div>
      </section>

      <section>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            id="ad_produced"
            checked={s.ad_produced}
            disabled={disabledFor('ad_produced')}
            onCheckedChange={(c) => set('ad_produced', Boolean(c))}
          />
          <span>Ad has been produced</span>
        </label>
        <p className="mt-1 text-xs text-muted-foreground">
          When checked on save, the timestamp is auto-recorded server-side via the
          ad_produced_at trigger column.
        </p>
      </section>

      <section>
        <Label htmlFor="notes">Notes</Label>
        <Textarea
          id="notes"
          value={s.notes}
          disabled={disabledFor('notes')}
          onChange={(e) => set('notes', e.target.value)}
          rows={4}
        />
      </section>

      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? 'Saving…' : isEdit ? 'Save changes' : 'Create ad order'}
        </Button>
      </div>
    </form>
  );
}
