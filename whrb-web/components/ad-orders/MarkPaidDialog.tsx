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
import { formatUSD } from '@/lib/ad-orders/shared';

type Props = {
  adOrderId: string;
  promoId: string;
  totalAmount: string;
  invoiceAlreadySent: boolean;
};

export function MarkPaidDialog({ adOrderId, promoId, totalAmount, invoiceAlreadySent }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmPromo, setConfirmPromo] = useState('');
  const [checkNumber, setCheckNumber] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const promoMatches = confirmPromo.trim().toUpperCase() === promoId.toUpperCase();
  const ready =
    promoMatches && checkNumber.trim().length > 0 && (invoiceAlreadySent || invoiceNumber.trim().length > 0);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/ad-orders/${adOrderId}/mark-paid`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          confirm_promo_id: confirmPromo.trim().toUpperCase(),
          client_check_number: checkNumber.trim(),
          invoice_number: invoiceNumber.trim() || undefined,
        }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
      setOpen(false);
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
        <Button variant="default">Mark paid</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mark {promoId} paid</DialogTitle>
          <DialogDescription>
            This commits {formatUSD(totalAmount)} to the books and locks every
            financial field on this row. Re-typing the promo ID prevents
            accidental clicks.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="cp_promo">Re-type promo ID</Label>
            <Input
              id="cp_promo"
              autoFocus
              value={confirmPromo}
              onChange={(e) => setConfirmPromo(e.target.value)}
              placeholder={promoId}
              autoComplete="off"
            />
          </div>
          <div>
            <Label htmlFor="cp_check">Client check / payment ref *</Label>
            <Input
              id="cp_check"
              value={checkNumber}
              onChange={(e) => setCheckNumber(e.target.value)}
              autoComplete="off"
            />
          </div>
          {!invoiceAlreadySent && (
            <div>
              <Label htmlFor="cp_inv">
                Invoice # <span className="text-muted-foreground">(no invoice on file yet)</span>
              </Label>
              <Input
                id="cp_inv"
                value={invoiceNumber}
                onChange={(e) => setInvoiceNumber(e.target.value)}
                autoComplete="off"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                invoice_sent_at will be stamped to today.
              </p>
            </div>
          )}
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
            {busy ? 'Marking paid…' : 'Confirm: mark paid'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
