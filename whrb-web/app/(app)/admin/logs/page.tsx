import Link from 'next/link';
import {
  listEventLog,
  listEventLogCategories,
  type EventLogRow,
} from '@/lib/queries/admin';
import { formatDateTime } from '@/lib/time';

export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;
const PAGE_SIZE = 50;

function firstString(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

const LEVELS: Array<{ value: EventLogRow['level'] | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'debug', label: 'Debug' },
  { value: 'info', label: 'Info' },
  { value: 'warn', label: 'Warn' },
  { value: 'error', label: 'Error' },
  { value: 'fatal', label: 'Fatal' },
];

const LEVEL_TONE: Record<string, string> = {
  debug: 'text-[hsl(var(--muted-foreground))]',
  info: 'text-[hsl(var(--foreground))]',
  warn: 'text-amber-700 dark:text-amber-300',
  error: 'text-[hsl(var(--destructive))]',
  fatal: 'text-[hsl(var(--destructive))] font-semibold',
};

function buildQuery(params: Record<string, string | undefined>): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '' && v !== 'all') usp.set(k, v);
  }
  const s = usp.toString();
  return s ? `?${s}` : '';
}

export default async function AdminLogsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const level = (firstString(sp.level) ?? 'all') as
    | EventLogRow['level']
    | 'all';
  const category = firstString(sp.category) ?? '';
  const q = firstString(sp.q) ?? '';
  const since = firstString(sp.since) ?? '';
  const until = firstString(sp.until) ?? '';
  const page = Math.max(0, Number.parseInt(firstString(sp.page) ?? '0', 10) || 0);

  const [{ rows, total }, categories] = await Promise.all([
    listEventLog(
      {
        level,
        category: category || undefined,
        q: q || undefined,
        since: since || undefined,
        until: until || undefined,
      },
      { page, pageSize: PAGE_SIZE },
    ),
    listEventLogCategories(),
  ]);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const baseParams = { level, category, q, since, until };

  return (
    <div className="space-y-6">
      <div>
        <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-[hsl(var(--muted-foreground))]">
          Admin
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
          Event log
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-[hsl(var(--muted-foreground))]">
          Unified stream from the pipeline, web server, and client. Use filters
          to isolate failures; click a row linked to a pipeline run to jump to
          its drill-down.
        </p>
      </div>

      <form
        method="get"
        data-testid="logs-filters"
        className="grid gap-3 rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--surface))] p-4 sm:grid-cols-2 lg:grid-cols-5"
      >
        <label className="block text-sm font-medium">
          Level
          <select
            name="level"
            defaultValue={level}
            data-testid="logs-level"
            className="mt-1.5 block w-full rounded-lg border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-2 py-1.5 text-sm"
          >
            {LEVELS.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-medium">
          Category
          <select
            name="category"
            defaultValue={category}
            data-testid="logs-category"
            className="mt-1.5 block w-full rounded-lg border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-2 py-1.5 text-sm"
          >
            <option value="">All</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-medium">
          Since (UTC)
          <input
            type="datetime-local"
            name="since"
            defaultValue={since}
            data-testid="logs-since"
            className="mt-1.5 block w-full rounded-lg border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-2 py-1.5 text-sm"
          />
        </label>
        <label className="block text-sm font-medium">
          Until (UTC)
          <input
            type="datetime-local"
            name="until"
            defaultValue={until}
            data-testid="logs-until"
            className="mt-1.5 block w-full rounded-lg border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-2 py-1.5 text-sm"
          />
        </label>
        <label className="block text-sm font-medium">
          Search
          <input
            type="text"
            name="q"
            defaultValue={q}
            placeholder="message contains…"
            data-testid="logs-search"
            className="mt-1.5 block w-full rounded-lg border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-2 py-1.5 text-sm"
          />
        </label>
        <div className="sm:col-span-2 lg:col-span-5 flex items-end justify-end gap-2">
          <Link
            href="/admin/logs"
            data-testid="logs-reset"
            className="rounded-md border border-[hsl(var(--border))] px-3 py-1.5 text-xs font-medium text-[hsl(var(--muted-foreground))]"
          >
            Reset
          </Link>
          <button
            type="submit"
            data-testid="logs-apply"
            className="rounded-md bg-[hsl(var(--primary))] px-4 py-1.5 text-xs font-semibold text-[hsl(var(--primary-foreground))]"
          >
            Apply
          </button>
        </div>
      </form>

      <div className="overflow-hidden rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--surface))]">
        <table data-testid="logs-table" className="w-full border-collapse text-sm">
          <thead className="bg-[hsl(var(--muted))]/50 text-left text-[11px] font-medium uppercase tracking-[0.14em] text-[hsl(var(--muted-foreground))]">
            <tr>
              <th className="px-4 py-3">Time</th>
              <th className="px-4 py-3">Level</th>
              <th className="px-4 py-3">Source</th>
              <th className="px-4 py-3">Category</th>
              <th className="px-4 py-3">Message</th>
              <th className="px-4 py-3">Run</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  data-testid="logs-empty"
                  className="px-4 py-10 text-center text-[hsl(var(--muted-foreground))]"
                >
                  No events match the current filters.
                </td>
              </tr>
            ) : (
              rows.map((e) => (
                <tr
                  key={e.id}
                  data-testid="log-row"
                  data-log-id={e.id}
                  data-level={e.level}
                  data-category={e.category ?? ''}
                  className="border-t border-[hsl(var(--border-subtle))]"
                >
                  <td className="whitespace-nowrap px-4 py-2 font-mono text-[11px] text-[hsl(var(--muted-foreground))]">
                    {formatDateTime(e.created_at)}
                  </td>
                  <td className={`px-4 py-2 text-[11px] uppercase tracking-widest ${LEVEL_TONE[e.level]}`}>
                    {e.level}
                  </td>
                  <td className="px-4 py-2 text-[11px] uppercase tracking-widest text-[hsl(var(--muted-foreground))]">
                    {e.source}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-[hsl(var(--muted-foreground))]">
                    {e.category ?? '—'}
                  </td>
                  <td className="px-4 py-2 text-sm">{e.message}</td>
                  <td className="px-4 py-2 font-mono text-[11px]">
                    {e.pipeline_run_id ? (
                      <Link
                        href={`/admin/runs/${e.pipeline_run_id}`}
                        data-testid={`log-run-link-${e.id}`}
                        className="text-[hsl(var(--primary))] hover:underline"
                      >
                        {e.pipeline_run_id.slice(0, 8)}
                      </Link>
                    ) : (
                      <span className="text-[hsl(var(--muted-foreground))]">—</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {pageCount > 1 && (
        <div
          data-testid="logs-pagination"
          className="flex items-center justify-between text-xs text-[hsl(var(--muted-foreground))]"
        >
          <span>
            Page {page + 1} of {pageCount} · {total} match{total === 1 ? '' : 'es'}
          </span>
          <div className="flex gap-2">
            {page > 0 && (
              <Link
                href={`/admin/logs${buildQuery({ ...baseParams, page: String(page - 1) })}`}
                className="rounded-md border border-[hsl(var(--border))] px-3 py-1 hover:bg-[hsl(var(--muted))]"
              >
                ← Previous
              </Link>
            )}
            {page + 1 < pageCount && (
              <Link
                href={`/admin/logs${buildQuery({ ...baseParams, page: String(page + 1) })}`}
                className="rounded-md border border-[hsl(var(--border))] px-3 py-1 hover:bg-[hsl(var(--muted))]"
              >
                Next →
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
