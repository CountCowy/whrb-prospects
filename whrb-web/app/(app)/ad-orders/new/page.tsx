import { redirect } from 'next/navigation';

import { getAuthed } from '@/lib/server/authz';
import { getOrgSettings } from '@/lib/queries/ad-orders';
import { AdOrderForm } from '@/components/ad-orders/AdOrderForm';

export default async function NewAdOrderPage() {
  const authz = await getAuthed();
  if (authz.kind === 'unauth') redirect('/login?next=/ad-orders/new');
  if (authz.user.role !== 'admin') redirect('/ad-orders');

  const settings = await getOrgSettings();

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">New ad order</h1>
        <p className="text-sm text-muted-foreground">
          Default commission rate: {settings.default_commission_pct}% · Default invoice net:{' '}
          {settings.default_invoice_net_days} days
        </p>
      </header>
      <AdOrderForm
        mode="create"
        defaultCommissionPct={Number(settings.default_commission_pct)}
      />
    </div>
  );
}
