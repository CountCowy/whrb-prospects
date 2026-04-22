'use client';

import type { MatchedRow, Assignee, SelectionMode } from './BulkActionsForm.types';

const PAGE_SIZES = [25, 50, 100, 250] as const;

export function BulkPreviewTable({
  rows,
  page,
  pageSize,
  total,
  countExceeded,
  excluded,
  onToggleRow,
  onPageChange,
  onPageSizeChange,
  mode,
  basketSize,
  assigneesById,
}: {
  rows: MatchedRow[];
  page: number;
  pageSize: number;
  total: number;
  countExceeded: boolean;
  excluded: Set<string>;
  onToggleRow: (id: string) => void;
  onPageChange: (p: number) => void;
  onPageSizeChange: (ps: number) => void;
  mode: SelectionMode;
  basketSize: number;
  assigneesById: Map<string, Assignee>;
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const from = page * pageSize + 1;
  const to = Math.min(page * pageSize + rows.length, total);

  return (
    <section
      className="rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--surface))] p-5 shadow-sm"
      data-testid="bulk-preview-table"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Matches</h2>
          <p className="text-xs text-[hsl(var(--muted-foreground))]">
            {total === 0 ? (
              'No rows match this filter.'
            ) : (
              <>
                Showing {from}–{to} of {total.toLocaleString()}
                {mode === 'filter' ? (
                  <> — {excluded.size > 0 ? `${excluded.size} excluded` : 'all rows included'}</>
                ) : (
                  <> — {basketSize} in basket</>
                )}
              </>
            )}
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]">
          Page size
          <select
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            data-testid="bulk-preview-pagesize"
            className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1 text-xs"
          >
            {PAGE_SIZES.map((ps) => (
              <option key={ps} value={ps}>
                {ps}
              </option>
            ))}
          </select>
        </label>
      </div>

      {countExceeded ? (
        <p
          className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700/60 dark:bg-amber-900/30 dark:text-amber-200"
          data-testid="bulk-preview-count-exceeded"
        >
          Filter matches more than 5,000 rows; only the first 5,000 are considered. Narrow the
          filter or use selection mode to curate a specific basket.
        </p>
      ) : null}

      <div className="mt-3 overflow-x-auto rounded-md border border-[hsl(var(--border-subtle))]">
        <table className="w-full min-w-[560px] border-collapse text-sm" data-testid="bulk-preview-rows">
          <thead className="bg-[hsl(var(--muted))]/50 text-left text-[11px] font-medium uppercase tracking-[0.14em] text-[hsl(var(--muted-foreground))]">
            <tr>
              <th className="px-3 py-2 w-10">
                <span className="sr-only">Include</span>
              </th>
              <th className="px-3 py-2">Company</th>
              <th className="px-3 py-2 w-16">Tier</th>
              <th className="px-3 py-2 w-28">State</th>
              <th className="px-3 py-2">Assigned</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-3 py-6 text-center text-[hsl(var(--muted-foreground))]"
                  data-testid="bulk-preview-empty"
                >
                  No rows on this page.
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const isExcluded = excluded.has(r.id);
                const assigneeLabel = r.assigned_to
                  ? assigneesById.get(r.assigned_to)?.label ?? r.assigned_to.slice(0, 8)
                  : '—';
                return (
                  <tr
                    key={r.id}
                    data-testid={`bulk-preview-row-${r.id}`}
                    className="border-t border-[hsl(var(--border-subtle))] transition-colors hover:bg-[hsl(var(--muted))]/30"
                  >
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={!isExcluded}
                        onChange={() => onToggleRow(r.id)}
                        data-testid={`bulk-preview-checkbox-${r.id}`}
                        aria-label={isExcluded ? 'Include row' : 'Exclude row'}
                        className="h-4 w-4 rounded border-[hsl(var(--border))] accent-[hsl(var(--primary))]"
                      />
                    </td>
                    <td
                      className={`truncate px-3 py-2 ${isExcluded ? 'text-[hsl(var(--muted-foreground))] line-through' : ''}`}
                    >
                      {r.company_name}
                    </td>
                    <td className="px-3 py-2 text-[hsl(var(--muted-foreground))]">
                      {r.tier ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-[hsl(var(--muted-foreground))]">
                      {r.state}
                    </td>
                    <td className="truncate px-3 py-2 text-[hsl(var(--muted-foreground))]">
                      {assigneeLabel}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {pageCount > 1 ? (
        <div
          className="mt-3 flex items-center justify-between text-xs text-[hsl(var(--muted-foreground))]"
          data-testid="bulk-preview-pagination"
        >
          <span>
            Page {page + 1} of {pageCount}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page === 0}
              onClick={() => onPageChange(page - 1)}
              data-testid="bulk-preview-prev"
              className="rounded-md border border-[hsl(var(--border))] px-3 py-1 hover:bg-[hsl(var(--muted))] disabled:opacity-40"
            >
              ← Prev
            </button>
            <button
              type="button"
              disabled={page + 1 >= pageCount}
              onClick={() => onPageChange(page + 1)}
              data-testid="bulk-preview-next"
              className="rounded-md border border-[hsl(var(--border))] px-3 py-1 hover:bg-[hsl(var(--muted))] disabled:opacity-40"
            >
              Next →
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
