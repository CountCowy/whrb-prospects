import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { getAuthed } from '@/lib/server/authz';
import {
  getAdOrder,
  listAmendments,
  listActivity,
} from '@/lib/queries/ad-orders';
import { AdOrderDetailPane } from '@/components/ad-orders/AdOrderDetailPane';

export default async function AdOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const authz = await getAuthed();
  if (authz.kind === 'unauth') redirect('/login');

  const { id } = await params;
  const row = await getAdOrder(id);
  if (!row) notFound();

  const [amendments, activity] = await Promise.all([
    listAmendments(id),
    listActivity(id),
  ]);

  const viewer = {
    id: authz.user.id,
    role: authz.user.role,
    isAdmin: authz.user.role === 'admin',
    isSalesperson: row.salesperson_id === authz.user.id,
    isSe: row.se_engineer_id === authz.user.id,
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <header className="mb-4 flex items-center justify-between">
        <div>
          <Link
            href="/ad-orders"
            className="text-sm text-muted-foreground hover:underline"
          >
            ← Back to all ad orders
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            {row.promo_id} <span className="text-muted-foreground">— {row.company_name}</span>
          </h1>
        </div>
        <Button asChild variant="outline">
          <Link href="/ad-orders">All orders</Link>
        </Button>
      </header>

      <AdOrderDetailPane
        row={row}
        amendments={amendments}
        activity={activity}
        viewer={viewer}
      />
    </div>
  );
}
