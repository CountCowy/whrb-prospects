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
  commissionAmount: string;
  salespersonLabel: string;
};

export function MarkCommissionPaidDialog({
  adOrderId,
  promoId,
  commissionAmount,
  salespersonLabel,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmPromo, setConfirmPromo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = confirmPromo.trim().toUpperCase() === promoId.toUpperCase();

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/ad-orders/${adOrderId}/mark-commission-paid`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirm_promo_id: confirmPromo.trim().toUpperCase() }),
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
        <Button variant="secondary">Mark commission paid</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mark commission paid</DialogTitle>
          <DialogDescription>
            Records that {formatUSD(commissionAmount)} has been paid to{' '}
            <strong>{salespersonLabel}</strong> for promo <strong>{promoId}</strong>.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="cpp_promo">Re-type promo ID</Label>
            <Input
              id="cpp_promo"
              autoFocus
              value={confirmPromo}
              onChange={(e) => setConfirmPromo(e.target.value)}
              placeholder={promoId}
              autoComplete="off"
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
            {busy ? 'Recording…' : 'Confirm: commission paid'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
