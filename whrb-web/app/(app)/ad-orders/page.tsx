import { redirect } from 'next/navigation';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { getAuthed } from '@/lib/server/authz';
import {
  listAdOrders,
  type AdOrderListFilters,
  type AdOrderListSort,
  DEFAULT_PAGE_SIZE,
  PAGE_SIZES,
} from '@/lib/queries/ad-orders';
import { AdOrderTable } from '@/components/ad-orders/AdOrderTable';
import { AdOrderListFilterBar } from '@/components/ad-orders/AdOrderListFilterBar';

type SearchParams = Record<string, string | string[] | undefined>;

function pickStr(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

export default async function AdOrdersListPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const authz = await getAuthed();
  if (authz.kind === 'unauth') redirect('/login?next=/ad-orders');

  const sp = await searchParams;

  const filters: AdOrderListFilters = {};
  for (const k of [
    'q',
    'salesperson',
    'se_engineer',
    'paid',
    'commission_paid',
    'status',
    'semester',
    'start_after',
    'end_before',
    'archived',
  ] as const) {
    const v = pickStr(sp[k]);
    if (v) (filters as Record<string, string>)[k] = v;
  }

  const sortField = (pickStr(sp.sort) ?? 'campaign_start') as AdOrderListSort['field'];
  const sortDir = (pickStr(sp.dir) ?? 'desc') as AdOrderListSort['dir'];
  const sort: AdOrderListSort = { field: sortField, dir: sortDir };

  const page = Math.max(1, Number(pickStr(sp.page) ?? 1));
  const pageSizeRaw = Number(pickStr(sp.pageSize) ?? DEFAULT_PAGE_SIZE);
  const pageSize = (PAGE_SIZES as readonly number[]).includes(pageSizeRaw)
    ? pageSizeRaw
    : DEFAULT_PAGE_SIZE;

  const result = await listAdOrders({ filters, sort, page, pageSize });
  const isAdmin = authz.user.role === 'admin';

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Ad Orders</h1>
          <p className="text-sm text-muted-foreground">
            {result.total.toLocaleString()} orders ·{' '}
            {filters.archived === 'true' ? 'Archived view' : 'Active view'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <Button asChild>
              <Link href="/ad-orders/new">New ad order</Link>
            </Button>
          )}
        </div>
      </header>

      <AdOrderListFilterBar filters={filters} sort={sort} />

      <div className="mt-4">
        <AdOrderTable
          rows={result.rows}
          sort={sort}
          page={page}
          pageSize={pageSize}
          total={result.total}
        />
      </div>
    </div>
  );
}
