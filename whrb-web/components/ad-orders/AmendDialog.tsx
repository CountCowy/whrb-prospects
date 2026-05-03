'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

type Props = {
  adOrderId: string;
  promoId: string;
};

const AMENDABLE_FIELDS: Array<{ value: string; label: string; type: 'text' | 'date' | 'number' | 'boolean' | 'uuid' }> = [
  { value: 'promo_id',              label: 'Promo ID',                  type: 'text' },
  { value: 'company_name',          label: 'Company name',              type: 'text' },
  { value: 'package_doc_url',       label: 'Package doc URL',           type: 'text' },
  { value: 'payment_contact_name',  label: 'Payment contact name',      type: 'text' },
  { value: 'payment_contact_email', label: 'Payment contact email',     type: 'text' },
  { value: 'invoice_number',        label: 'Invoice #',                 type: 'text' },
  { value: 'client_check_number',   label: 'Client check #',            type: 'text' },
  { value: 'notes',                 label: 'Notes',                     type: 'text' },
  { value: 'prospect_id',           label: 'Prospect (uuid)',           type: 'uuid' },
  { value: 'salesperson_id',        label: 'Salesperson (uuid)',        type: 'uuid' },
  { value: 'se_engineer_id',        label: 'SE engineer (uuid)',        type: 'uuid' },
  { value: 'total_amount',          label: 'Total ($)',                 type: 'number' },
  { value: 'discount_pct',          label: 'Discount %',                type: 'number' },
  { value: 'commission_pct',        label: 'Commission %',              type: 'number' },
  { value: 'campaign_start',        label: 'Campaign start',            type: 'date' },
  { value: 'campaign_end',          label: 'Campaign end',              type: 'date' },
  { value: 'invoice_sent_at',       label: 'Invoice sent date',         type: 'date' },
  { value: 'is_nonprofit_rate',     label: 'Non-profit rate',           type: 'boolean' },
  { value: 'ad_produced',           label: 'Ad produced',               type: 'boolean' },
];

export function AmendDialog({ adOrderId, promoId }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [field, setField] = useState(AMENDABLE_FIELDS[0].value);
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fdef = AMENDABLE_FIELDS.find((f) => f.value === field) ?? AMENDABLE_FIELDS[0];
  const ready = value.trim().length > 0 && reason.trim().length >= 5;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/ad-orders/${adOrderId}/amend`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          field,
          new_value: value,
          reason,
        }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
      setOpen(false);
      setValue('');
      setReason('');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">Amend (admin)</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Amend {promoId}</DialogTitle>
          <DialogDescription>
            Records an immutable amendment row with old/new value + reason.
            This is the only way to change financial fields after a row has
            been marked paid.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="amend_field">Field</Label>
            <select
              id="amend_field"
              value={field}
              onChange={(e) => setField(e.target.value)}
              className="w-full rounded-md border bg-background px-2 py-1 text-sm"
            >
              {AMENDABLE_FIELDS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="amend_value">New value</Label>
            {fdef.type === 'boolean' ? (
              <select
                id="amend_value"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className="w-full rounded-md border bg-background px-2 py-1 text-sm"
              >
                <option value="">— pick —</option>
                <option value="true">true</option>
                <option value="false">false</option>
              </select>
            ) : (
              <Input
                id="amend_value"
                type={fdef.type === 'date' ? 'date' : fdef.type === 'number' ? 'number' : 'text'}
                step={fdef.type === 'number' ? '0.01' : undefined}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="(empty = NULL for nullable fields)"
              />
            )}
          </div>
          <div>
            <Label htmlFor="amend_reason">Reason (≥ 5 chars)</Label>
            <Textarea
              id="amend_reason"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. typo: $500 → $550 per email from client 5/3/26"
            />
          </div>
          {error && (
            <div className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-900 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-200">
              {error}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!ready || busy}>
            {busy ? 'Amending…' : 'Apply amendment'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
