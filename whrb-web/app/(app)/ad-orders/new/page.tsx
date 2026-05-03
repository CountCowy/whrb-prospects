import { redirect } from 'next/navigation';

import { getAuthed } from '@/lib/server/authz';
import { getOrgSettings } from '@/lib/queries/ad-orders';
import { listProfiles } from '@/lib/queries/profiles';
import { getProspect } from '@/lib/queries/prospects';
import { AdOrderForm } from '@/components/ad-orders/AdOrderForm';

export default async function NewAdOrderPage({
  searchParams,
}: {
  searchParams: Promise<{ prospect?: string }>;
}) {
  const authz = await getAuthed();
  if (authz.kind === 'unauth') redirect('/login?next=/ad-orders/new');
  if (authz.user.role !== 'admin') redirect('/ad-orders');

  const params = await searchParams;
  const [settings, profiles, prospect] = await Promise.all([
    getOrgSettings(),
    listProfiles(),
    params.prospect ? getProspect(params.prospect) : Promise.resolve(null),
  ]);

  const prefill = prospect
    ? { prospectId: prospect.id, companyName: prospect.company_name, prospectName: prospect.company_name }
    : null;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">New ad order</h1>
        <p className="text-sm text-muted-foreground">
          Default commission rate: {settings.default_commission_pct}% · Default invoice net:{' '}
          {settings.default_invoice_net_days} days
          {prefill && (
            <>
              {' · '}
              Linked to prospect:{' '}
              <strong className="font-medium">{prefill.prospectName}</strong>
            </>
          )}
        </p>
      </header>
      <AdOrderForm
        mode="create"
        defaultCommissionPct={Number(settings.default_commission_pct)}
        profiles={profiles}
        prefill={prefill}
      />
    </div>
  );
}
