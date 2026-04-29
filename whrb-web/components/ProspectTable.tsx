'use client';

import Link from 'next/link';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useMemo, useState } from 'react';
import type { Prospect } from '@/lib/queries/prospects';
import type { ProspectTagView } from '@/lib/queries/prospect-tags';
import { ColumnVisibilityMenu, type ColumnDef } from '@/components/ColumnVisibilityMenu';
import { TagChips } from '@/components/TagChips';
import { TierBadge } from '@/components/TierBadge';
import { StateBadge } from '@/components/StateBadge';
import { formatDate } from '@/lib/time';
import { Button } from '@/components/ui/button';
import { useImpressions } from '@/lib/hooks/use-impressions';

export const PAGE_SIZES = [25, 50, 100, 250] as const;

type Props = {
  rows: Prospect[];
  total: number;
  page: number;
  pageSize: number;
  sort: { field: string; dir: 'asc' | 'desc' };
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: { href: string; label: string };
  /**
   * Optional extras rendered in the table-controls row, to the right of
   * Rows + Columns. /prospects injects a vertical Separator + Export;
   * other callers (e.g. /my) pass nothing.
   */
  controlsSlot?: React.ReactNode;
  /**
   * Per-prospect tag rows fetched server-side. The compact-mode tag
   * chips column reads from this map. Undefined means tags are not
   * rendered (e.g. on test fixtures that haven't seeded prospect_tags).
   */
  tagsByProspect?: Record<string, ProspectTagView[]>;
  /** auth.uid() — required for tag chip lock state. */
  currentUserId?: string;
  /** Whether the active user is admin — affects chip interactivity. */
  isAdmin?: boolean;
};

type ColDef = ColumnDef & {
  sortable?: boolean;
  render: (p: Prospect) => React.ReactNode;
  width?: string;
  align?: 'left' | 'right';
};

const SORTABLE: Record<string, boolean> = {
  company_name: true,
  tier: true,
  state: true,
  priority_score: true,
  zip: true,
  source: true,
  pipeline_last_seen_at: true,
  created_at: true,
};

function assigneeLabel(p: Prospect): string {
  if (!p.assignee) return '—';
  return p.assignee.display_name || p.assignee.email.split('@')[0];
}

function textCell(value: string | null | undefined): React.ReactNode {
  if (!value) return <span className="text-[hsl(var(--muted-foreground))]">—</span>;
  return value;
}

function COLUMNS(opts?: {
  tagsByProspect?: Record<string, ProspectTagView[]>;
  currentUserId?: string;
  isAdmin?: boolean;
}): ColDef[] {
  const tagsByProspect = opts?.tagsByProspect;
  const currentUserId = opts?.currentUserId;
  const isAdmin = opts?.isAdmin ?? false;
  return [
    {
      key: 'company_name',
      label: 'Company',
      defaultVisible: true,
      sortable: true,
      width: 'min-w-60',
      render: (p) => (
        <Link
          href={`/prospects/${p.id}`}
          className="font-medium text-[hsl(var(--foreground))] hover:text-[hsl(var(--primary))] hover:underline"
        >
          {p.company_name}
        </Link>
      ),
    },
    {
      key: 'assigned_to',
      label: 'Assigned',
      defaultVisible: true,
      render: (p) => <span className="text-sm">{assigneeLabel(p)}</span>,
    },
    { key: 'contact_name', label: 'Contact', defaultVisible: true, render: (p) => textCell(p.contact_name) },
    { key: 'tier', label: 'Tier', defaultVisible: true, sortable: true, render: (p) => <TierBadge tier={p.tier} /> },
    { key: 'state', label: 'State', defaultVisible: true, sortable: true, render: (p) => <StateBadge state={p.state} /> },
    {
      key: 'tags',
      label: 'Tags',
      defaultVisible: true,
      width: 'min-w-64',
      render: (p) => {
        if (!tagsByProspect || !currentUserId) {
          return <span className="text-[10px] text-[hsl(var(--muted-foreground))]">—</span>;
        }
        const tags = tagsByProspect[p.id] ?? [];
        return (
          <TagChips
            prospectId={p.id}
            tags={tags}
            mode="compact"
            currentUserId={currentUserId}
            isAdmin={isAdmin}
            interactive={false}
          />
        );
      },
    },
    { key: 'company_phone', label: 'Company phone', defaultVisible: true, render: (p) => textCell(p.company_phone) },
    { key: 'contact_phone', label: 'Contact phone', defaultVisible: false, render: (p) => textCell(p.contact_phone) },
    { key: 'company_email', label: 'Company email', defaultVisible: true, render: (p) => textCell(p.company_email) },
    {
      key: 'contact_email',
      label: 'Contact email',
      defaultVisible: true,
      width: 'min-w-56',
      render: (p) => {
        if (!p.contact_email) {
          return <span className="text-[hsl(var(--muted-foreground))]">—</span>;
        }
        const extra = Math.max(0, (p.contact_email_count ?? 1) - 1);
        return (
          <span className="inline-flex min-w-0 items-center gap-1">
            <span className="truncate">{p.contact_email}</span>
            {extra > 0 ? (
              <span
                className="rounded bg-[hsl(var(--primary-soft))] px-1 text-[10px] font-medium text-[hsl(var(--primary))]"
                title={`${extra} additional email${extra === 1 ? '' : 's'}`}
                aria-label={`${extra} additional email${extra === 1 ? '' : 's'}`}
                data-testid={`contact-email-extra-${p.id}`}
              >
                +{extra}
              </span>
            ) : null}
          </span>
        );
      },
    },
    {
      key: 'website',
      label: 'Website',
      defaultVisible: true,
      render: (p) =>
        p.website ? (
          <a
            href={p.website}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[hsl(var(--primary))] hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {p.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}
          </a>
        ) : (
          textCell(null)
        ),
    },
    { key: 'category', label: 'Category', defaultVisible: true, render: (p) => textCell(p.category) },
    { key: 'source', label: 'Source', defaultVisible: false, sortable: true, render: (p) => textCell(p.source) },
    { key: 'zip', label: 'ZIP', defaultVisible: true, sortable: true, render: (p) => textCell(p.zip) },
    { key: 'address', label: 'Address', defaultVisible: false, render: (p) => textCell(p.address) },
    {
      key: 'priority_score',
      label: 'Score',
      defaultVisible: true,
      sortable: true,
      align: 'right',
      render: (p) => (
        <span className="tabular-nums font-medium">{p.priority_score ?? '—'}</span>
      ),
    },
    {
      key: 'rating',
      label: 'Rating',
      defaultVisible: false,
      align: 'right',
      render: (p) => <span className="tabular-nums">{p.rating ?? '—'}</span>,
    },
    {
      key: 'review_count',
      label: 'Reviews',
      defaultVisible: false,
      align: 'right',
      render: (p) => <span className="tabular-nums">{p.review_count ?? '—'}</span>,
    },
    {
      key: 'is_nonprofit',
      label: 'Nonprofit',
      defaultVisible: false,
      render: (p) =>
        p.is_nonprofit ? (
          <span className="inline-flex items-center gap-1 text-[hsl(var(--tier-a))]">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-[hsl(var(--tier-a))]" />
            Yes
          </span>
        ) : (
          textCell(null)
        ),
    },
    { key: 'ein', label: 'EIN', defaultVisible: false, render: (p) => textCell(p.ein) },
    {
      key: 'pipeline_last_seen_at',
      label: 'Last seen',
      defaultVisible: false,
      sortable: true,
      render: (p) => (p.pipeline_last_seen_at ? formatDate(p.pipeline_last_seen_at) : textCell(null)),
    },
    {
      key: 'created_at',
      label: 'Added',
      defaultVisible: false,
      sortable: true,
      render: (p) => formatDate(p.created_at),
    },
  ];
}

export function ProspectTable({
  rows,
  total,
  page,
  pageSize,
  sort,
  emptyTitle,
  emptyDescription,
  emptyAction,
  controlsSlot,
  tagsByProspect,
  currentUserId,
  isAdmin,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const allColumns = useMemo(
    () => COLUMNS({ tagsByProspect, currentUserId, isAdmin }),
    [tagsByProspect, currentUserId, isAdmin],
  );

  // Fire impression pings for source-quality `searched_rate` metric. Key
  // = pathname + searchParams so the dedup is per-filter-state, per-page.
  // Empty filter ⇒ default view ⇒ key starts with the path; non-empty
  // filter signatures distinguish "searched" from "default" downstream.
  const impressionKey = `${pathname}?${params.toString()}`;
  const visibleIds = useMemo(() => rows.map((r) => r.id), [rows]);
  useImpressions(visibleIds, impressionKey);
  const [visible, setVisible] = useState<Set<string>>(
    new Set(allColumns.filter((c) => c.defaultVisible !== false).map((c) => c.key)),
  );
  // `company_name` stays sticky + always visible.
  const shownColumns = useMemo(() => {
    const forced = new Set(visible);
    forced.add('company_name');
    return allColumns.filter((c) => forced.has(c.key));
  }, [visible, allColumns]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const clampedPage = Math.min(Math.max(page, 1), totalPages);

  function buildUrl(next: Record<string, string | null>): string {
    const n = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === '') n.delete(k);
      else n.set(k, v);
    }
    return `${pathname}?${n.toString()}`;
  }

  function handleSort(field: string) {
    if (!SORTABLE[field]) return;
    const nextDir: 'asc' | 'desc' = sort.field === field && sort.dir === 'desc' ? 'asc' : 'desc';
    router.push(buildUrl({ sort: field, dir: nextDir, page: '1' }));
  }

  function onPageSizeChange(e: React.ChangeEvent<HTMLSelectElement>) {
    router.push(buildUrl({ pageSize: e.target.value, page: '1' }));
  }

  function goPage(p: number) {
    router.push(buildUrl({ page: String(p) }));
  }

  if (rows.length === 0) {
    const hasFilters = ['q', 'tier', 'state', 'source', 'assigned', 'is_nonprofit', 'zip', 'category'].some(
      (k) => params.get(k),
    );
    return (
      <div className="flex items-center justify-between gap-3 border-b border-[hsl(var(--border-subtle))] pb-3">
        <ColumnVisibilityMenu columns={allColumns} onChange={setVisible} />
        <div className="text-xs text-[hsl(var(--muted-foreground))]">0 rows</div>
        <EmptyState
          hasFilters={hasFilters}
          title={emptyTitle}
          description={emptyDescription}
          action={emptyAction}
          onClear={() => router.push(pathname)}
        />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-[hsl(var(--muted-foreground))]" data-testid="results-summary">
          {total.toLocaleString()} prospect{total === 1 ? '' : 's'} · page {clampedPage} of {totalPages}
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            Rows
            <select
              value={pageSize}
              onChange={onPageSizeChange}
              data-testid="page-size"
              className="flex h-8 rounded-md border border-input bg-transparent px-2 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {PAGE_SIZES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <ColumnVisibilityMenu columns={allColumns} onChange={setVisible} />
          {controlsSlot}
        </div>
      </div>
      <div
        data-testid="prospect-table-wrap"
        className="overflow-auto rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--surface))] shadow-[var(--shadow-sm)]"
        style={{ maxHeight: '70vh' }}
      >
        <table
          data-testid="prospect-table"
          className="w-max min-w-full text-left text-sm"
        >
          <thead className="sticky top-0 z-10 bg-[hsl(var(--surface-2))] text-[11px] font-medium uppercase tracking-wider text-[hsl(var(--muted-foreground))] shadow-[0_1px_0_0_hsl(var(--border-subtle))]">
            <tr>
              {shownColumns.map((c, idx) => {
                const isFirst = idx === 0;
                const isActiveSort = sort.field === c.key;
                return (
                  <th
                    key={c.key}
                    scope="col"
                    data-testid={`th-${c.key}`}
                    className={[
                      'whitespace-nowrap px-3 py-2',
                      c.align === 'right' ? 'text-right' : 'text-left',
                      isFirst ? 'sticky left-0 z-20 bg-[hsl(var(--surface-2))]' : '',
                      c.sortable ? 'cursor-pointer select-none hover:text-[hsl(var(--foreground))]' : '',
                    ].join(' ')}
                    onClick={() => c.sortable && handleSort(c.key)}
                  >
                    <span className="inline-flex items-center gap-1">
                      {c.label}
                      {c.sortable && (
                        <span className="text-[10px]">
                          {isActiveSort ? (sort.dir === 'desc' ? '▼' : '▲') : '⇅'}
                        </span>
                      )}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr
                key={p.id}
                data-testid="prospect-row"
                data-id={p.id}
                className="border-t border-[hsl(var(--border-subtle))] hover:bg-[hsl(var(--muted))]/40"
              >
                {shownColumns.map((c, idx) => {
                  const isFirst = idx === 0;
                  return (
                    <td
                      key={c.key}
                      className={[
                        'whitespace-nowrap px-3 py-2',
                        c.align === 'right' ? 'text-right' : 'text-left',
                        isFirst ? 'sticky left-0 bg-[hsl(var(--surface))] group-hover:bg-[hsl(var(--muted))]/40' : '',
                      ].join(' ')}
                    >
                      {c.render(p)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-[hsl(var(--muted-foreground))]">
          Showing {(clampedPage - 1) * pageSize + 1}–
          {Math.min(total, clampedPage * pageSize)} of {total.toLocaleString()}
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="page-prev"
            onClick={() => goPage(Math.max(1, clampedPage - 1))}
            disabled={clampedPage <= 1}
            className="h-8 text-xs"
          >
            Prev
          </Button>
          <span className="px-2 text-xs tabular-nums">
            {clampedPage} / {totalPages}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="page-next"
            onClick={() => goPage(Math.min(totalPages, clampedPage + 1))}
            disabled={clampedPage >= totalPages}
            className="h-8 text-xs"
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}

function EmptyState({
  hasFilters,
  title,
  description,
  action,
  onClear,
}: {
  hasFilters: boolean;
  title?: string;
  description?: string;
  action?: { href: string; label: string };
  onClear: () => void;
}) {
  return (
    <div
      data-testid="empty-state"
      className="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-6 py-10 text-center"
    >
      <div className="text-sm font-semibold">
        {hasFilters ? 'No prospects match those filters.' : title ?? 'No prospects yet.'}
      </div>
      <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
        {hasFilters
          ? 'Try loosening a filter or clearing the search.'
          : description ?? 'Once the pipeline runs, rows will appear here.'}
      </p>
      <div className="mt-4 flex items-center gap-2">
        {hasFilters ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onClear}
            data-testid="empty-clear-filters"
            className="text-xs"
          >
            Clear all filters
          </Button>
        ) : (
          action && (
            <Button asChild size="sm" className="text-xs">
              <Link href={action.href}>{action.label}</Link>
            </Button>
          )
        )}
      </div>
    </div>
  );
}
