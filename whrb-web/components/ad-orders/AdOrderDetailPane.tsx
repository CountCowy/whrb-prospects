'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AdOrderForm } from '@/components/ad-orders/AdOrderForm';
import { AmendDialog } from '@/components/ad-orders/AmendDialog';
import { MarkPaidDialog } from '@/components/ad-orders/MarkPaidDialog';
import { MarkCommissionPaidDialog } from '@/components/ad-orders/MarkCommissionPaidDialog';
import { formatUSD } from '@/lib/ad-orders/shared';
import type {
  AdOrderActivity,
  AdOrderAmendment,
  AdOrderRow,
} from '@/lib/queries/ad-orders';

type Viewer = {
  id: string;
  role: 'admin' | 'rep';
  isAdmin: boolean;
  isSalesperson: boolean;
  isSe: boolean;
};

type Props = {
  row: AdOrderRow;
  amendments: AdOrderAmendment[];
  activity: AdOrderActivity[];
  viewer: Viewer;
};

export function AdOrderDetailPane({ row, amendments, activity, viewer }: Props) {
  const router = useRouter();
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const isLocked = row.is_paid;
  const isArchived = !!row.archived_at;
  const salespersonLabel =
    row.salesperson?.display_name ?? row.salesperson?.email ?? '(unassigned)';

  async function archive() {
    if (!confirm(`Archive ${row.promo_id}? It will be hidden from the default list.`)) return;
    setArchiveBusy(true);
    setArchiveError(null);
    try {
      const r = await fetch(`/api/ad-orders/${row.id}/archive`, { method: 'POST' });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
      router.refresh();
    } catch (err) {
      setArchiveError(err instanceof Error ? err.message : String(err));
    } finally {
      setArchiveBusy(false);
    }
  }

  async function restore() {
    setArchiveBusy(true);
    setArchiveError(null);
    try {
      const r = await fetch(`/api/ad-orders/${row.id}/restore`, { method: 'POST' });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
      router.refresh();
    } catch (err) {
      setArchiveError(err instanceof Error ? err.message : String(err));
    } finally {
      setArchiveBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Summary card */}
      <div className="rounded-lg border bg-card p-4">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Stat label="Total" value={formatUSD(row.total_amount)} strong />
          <Stat label="Commission" value={formatUSD(row.commission_amount)} />
          <Stat label="Salesperson" value={salespersonLabel} />
          <Stat label="Campaign" value={`${row.campaign_start} → ${row.campaign_end}`} />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <StatusBadge label="Produced" on={row.ad_produced} />
          <StatusBadge label="Invoiced" on={!!row.invoice_sent_at} />
          <StatusBadge label="Paid" on={row.is_paid} />
          <StatusBadge label="Comm. paid" on={row.commission_paid} />
          {isArchived && (
            <Badge variant="secondary" className="bg-slate-200 dark:bg-slate-800">
              Archived
            </Badge>
          )}
          {isLocked && !isArchived && (
            <Badge variant="secondary" className="bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
              🔒 Locked (paid)
            </Badge>
          )}
        </div>
      </div>

      {/* Action buttons (admin only) */}
      {viewer.isAdmin && !isArchived && (
        <div className="flex flex-wrap items-center gap-2">
          {!row.is_paid && (
            <MarkPaidDialog
              adOrderId={row.id}
              promoId={row.promo_id}
              totalAmount={row.total_amount}
              invoiceAlreadySent={!!row.invoice_sent_at}
            />
          )}
          {row.is_paid && !row.commission_paid && row.salesperson_id && (
            <MarkCommissionPaidDialog
              adOrderId={row.id}
              promoId={row.promo_id}
              commissionAmount={row.commission_amount}
              salespersonLabel={salespersonLabel}
            />
          )}
          {isLocked && (
            <AmendDialog adOrderId={row.id} promoId={row.promo_id} />
          )}
          <Button variant="outline" onClick={archive} disabled={archiveBusy}>
            {archiveBusy ? 'Archiving…' : 'Archive'}
          </Button>
          {archiveError && (
            <span className="text-sm text-rose-700 dark:text-rose-300">{archiveError}</span>
          )}
        </div>
      )}
      {viewer.isAdmin && isArchived && (
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={restore} disabled={archiveBusy}>
            {archiveBusy ? 'Restoring…' : 'Restore from archive'}
          </Button>
          {archiveError && (
            <span className="text-sm text-rose-700 dark:text-rose-300">{archiveError}</span>
          )}
        </div>
      )}

      {/* Tabs */}
      <Tabs defaultValue="order" className="space-y-4">
        <TabsList>
          <TabsTrigger value="order">Order</TabsTrigger>
          <TabsTrigger value="amendments">
            Amendments {amendments.length > 0 && <span className="ml-1 text-xs">({amendments.length})</span>}
          </TabsTrigger>
          <TabsTrigger value="activity">
            Activity {activity.length > 0 && <span className="ml-1 text-xs">({activity.length})</span>}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="order">
          <AdOrderForm
            mode="edit"
            row={row}
            isAdmin={viewer.isAdmin}
            isLocked={isLocked}
          />
        </TabsContent>

        <TabsContent value="amendments">
          <AmendmentsList rows={amendments} />
        </TabsContent>

        <TabsContent value="activity">
          <ActivityList rows={activity} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={strong ? 'text-lg font-semibold' : 'text-sm'}>{value}</div>
    </div>
  );
}

function StatusBadge({ label, on }: { label: string; on: boolean }) {
  return (
    <Badge
      variant="secondary"
      className={
        on
          ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200'
          : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
      }
    >
      {on ? `✓ ${label}` : label}
    </Badge>
  );
}

function AmendmentsList({ rows }: { rows: AdOrderAmendment[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-md border bg-card p-4 text-sm text-muted-foreground">
        No amendments recorded.
      </div>
    );
  }
  return (
    <ol className="space-y-2">
      {rows.map((a) => (
        <li key={a.id} className="rounded-md border bg-card p-3 text-sm">
          <div className="flex items-center justify-between">
            <div className="font-medium">
              {a.field}{' '}
              <span className="text-muted-foreground">
                · by {a.amender?.display_name ?? a.amender?.email ?? a.amended_by}
              </span>
            </div>
            <time className="text-xs text-muted-foreground">{a.amended_at}</time>
          </div>
          <div className="mt-1 grid grid-cols-2 gap-2 text-xs">
            <div>
              <div className="text-muted-foreground">Old</div>
              <code className="break-all">{JSON.stringify(a.old_value)}</code>
            </div>
            <div>
              <div className="text-muted-foreground">New</div>
              <code className="break-all">{JSON.stringify(a.new_value)}</code>
            </div>
          </div>
          <div className="mt-2 text-xs text-muted-foreground">Reason: {a.reason}</div>
        </li>
      ))}
    </ol>
  );
}

function ActivityList({ rows }: { rows: AdOrderActivity[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-md border bg-card p-4 text-sm text-muted-foreground">
        No activity yet.
      </div>
    );
  }
  return (
    <ol className="space-y-2">
      {rows.map((e) => (
        <li key={e.id} className="rounded-md border bg-card p-3 text-sm">
          <div className="flex items-center justify-between">
            <div className="font-medium">{e.category}</div>
            <time className="text-xs text-muted-foreground">{e.created_at}</time>
          </div>
          <div className="mt-1 text-sm">{e.message}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            <code className="break-all">{JSON.stringify(e.context)}</code>
          </div>
        </li>
      ))}
    </ol>
  );
}
