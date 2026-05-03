'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PAGE_SIZES, formatUSD, type AdOrderListSort } from '@/lib/ad-orders/shared';
import type { AdOrderRow } from '@/lib/queries/ad-orders';

type Props = {
  rows: AdOrderRow[];
  sort: AdOrderListSort;
  page: number;
  pageSize: number;
  total: number;
};

const COLUMNS: Array<{
  key: string;
  label: string;
  sortable?: AdOrderListSort['field'];
  className?: string;
  align?: 'left' | 'right';
}> = [
  { key: 'promo_id',       label: 'Promo',       sortable: 'promo_id' },
  { key: 'company_name',   label: 'Company' },
  { key: 'salesperson',    label: 'Salesperson' },
  { key: 'campaign_start', label: 'Campaign',    sortable: 'campaign_start' },
  { key: 'total_amount',   label: 'Total',       sortable: 'total_amount', align: 'right' },
  { key: 'commission_amount', label: 'Comm.',    align: 'right' },
  { key: 'status',         label: 'Status' },
];

function statusOf(row: AdOrderRow): { label: string; tone: 'amber' | 'blue' | 'green' | 'slate' | 'red' } {
  if (row.archived_at) return { label: 'Archived', tone: 'slate' };
  if (row.commission_paid) return { label: 'Closed', tone: 'green' };
  if (row.is_paid) return { label: 'Awaiting commission', tone: 'blue' };
  if (row.invoice_sent_at) return { label: 'Awaiting payment', tone: 'amber' };
  if (row.ad_produced) return { label: 'Awaiting invoice', tone: 'amber' };
  return { label: 'Pending production', tone: 'slate' };
}

const TONE_CLASSES: Record<string, string> = {
  amber: 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200',
  blue:  'bg-blue-100  text-blue-900  dark:bg-blue-900/40  dark:text-blue-200',
  green: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200',
  slate: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  red:   'bg-rose-100 text-rose-900 dark:bg-rose-900/40 dark:text-rose-200',
};

export function AdOrderTable({ rows, sort, page, pageSize, total }: Props) {
  const router = useRouter();
  const sp = useSearchParams();

  const totals = useMemo(() => {
    let sumTotal = 0;
    let sumComm = 0;
    let sumCommPaid = 0;
    for (const r of rows) {
      sumTotal += Number(r.total_amount) || 0;
      sumComm += Number(r.commission_amount) || 0;
      if (r.commission_paid) sumCommPaid += Number(r.commission_amount) || 0;
    }
    return { sumTotal, sumComm, sumCommPaid };
  }, [rows]);

  function buildHref(overrides: Record<string, string | undefined>): string {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(overrides)) {
      if (v === undefined || v === '') next.delete(k);
      else next.set(k, v);
    }
    return `?${next.toString()}`;
  }

  function clickSort(field: AdOrderListSort['field']) {
    const dir: 'asc' | 'desc' = sort.field === field && sort.dir === 'asc' ? 'desc' : 'asc';
    router.push(buildHref({ sort: field, dir, page: undefined }));
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="rounded-md border bg-card">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr>
              {COLUMNS.map((c) => (
                <th
                  key={c.key}
                  className={`whitespace-nowrap px-3 py-2 text-left font-medium ${c.align === 'right' ? 'text-right' : ''}`}
                >
                  {c.sortable ? (
                    <button
                      type="button"
                      className="hover:underline"
                      onClick={() => clickSort(c.sortable!)}
                    >
                      {c.label}
                      {sort.field === c.sortable && (
                        <span aria-hidden> {sort.dir === 'asc' ? '▲' : '▼'}</span>
                      )}
                    </button>
                  ) : (
                    c.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={COLUMNS.length} className="px-3 py-8 text-center text-muted-foreground">
                  No ad orders match these filters.
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const status = statusOf(r);
              return (
                <tr
                  key={r.id}
                  className={`border-t hover:bg-muted/30 ${r.archived_at ? 'opacity-60' : ''}`}
                >
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">
                    <Link href={`/ad-orders/${r.id}`} className="hover:underline">
                      {r.promo_id}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{r.company_name}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                    {r.salesperson?.display_name ?? r.salesperson?.email ?? '—'}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                    {r.campaign_start} → {r.campaign_end}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-medium">
                    {formatUSD(r.total_amount)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right text-muted-foreground">
                    {formatUSD(r.commission_amount)}
                  </td>
                  <td className="px-3 py-2">
                    <Badge className={TONE_CLASSES[status.tone]} variant="secondary">
                      {status.label}
                    </Badge>
                    {r.is_paid && !r.commission_paid && (
                      <span aria-label="locked" title="Row locked: paid" className="ml-1">
                        🔒
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          {rows.length > 0 && (
            <tfoot className="bg-muted/30 text-muted-foreground">
              <tr className="border-t">
                <td colSpan={4} className="px-3 py-2 text-right">
                  Page totals
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-medium">
                  {formatUSD(totals.sumTotal)}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right">
                  {formatUSD(totals.sumComm)}{' '}
                  <span className="text-xs">
                    (paid {formatUSD(totals.sumCommPaid)})
                  </span>
                </td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t px-3 py-2 text-sm">
        <div className="text-muted-foreground">
          Showing {(rows.length === 0 ? 0 : (page - 1) * pageSize + 1)}–
          {(page - 1) * pageSize + rows.length} of {total.toLocaleString()}
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2">
            <span className="text-muted-foreground">Per page</span>
            <select
              value={pageSize}
              onChange={(e) =>
                router.push(buildHref({ pageSize: e.target.value, page: '1' }))
              }
              className="rounded-md border bg-background px-2 py-1"
            >
              {PAGE_SIZES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => router.push(buildHref({ page: String(page - 1) }))}
          >
            Prev
          </Button>
          <span className="text-muted-foreground">
            {page} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => router.push(buildHref({ page: String(page + 1) }))}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
