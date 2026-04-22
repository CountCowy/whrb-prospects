import Link from 'next/link';
import { listPipelineRuns } from '@/lib/queries/admin';
import { formatDateTime } from '@/lib/time';
import { TriggerRunButton } from '@/components/admin/TriggerRunButton';

export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;
const PAGE_SIZE = 25;

function firstString(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

const STATUS_TONE: Record<string, string> = {
  queued: 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]',
  running: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200',
  success: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  failed: 'bg-[hsl(var(--destructive))]/10 text-[hsl(var(--destructive))]',
};

function duration(start: string | null, end: string | null): string {
  if (!start || !end) return '—';
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 0 || Number.isNaN(ms)) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${rem}s`;
}

export default async function AdminRunsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const page = Math.max(0, Number.parseInt(firstString(sp.page) ?? '0', 10) || 0);
  const { rows, total } = await listPipelineRuns({ page, pageSize: PAGE_SIZE });
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-[hsl(var(--muted-foreground))]">
            Admin
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
            Pipeline runs
          </h1>
          <p className="mt-2 max-w-3xl text-sm text-[hsl(var(--muted-foreground))]">
            Every CLI + dispatched pipeline execution is recorded here with its
            status, duration, and upsert count. Click a row for the event-log
            trace.
          </p>
        </div>
        <TriggerRunButton />
      </div>

      <div className="overflow-x-auto rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--surface))]">
        <table
          data-testid="runs-table"
          className="w-full min-w-[720px] border-collapse text-sm"
        >
          <thead className="bg-[hsl(var(--muted))]/50 text-left text-[11px] font-medium uppercase tracking-[0.14em] text-[hsl(var(--muted-foreground))]">
            <tr>
              <th className="px-4 py-3">Started</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Duration</th>
              <th className="px-4 py-3">Rows</th>
              <th className="px-4 py-3">Args</th>
              <th className="px-4 py-3">Triggered by</th>
              <th className="px-4 py-3">Run ID</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-10 text-center text-[hsl(var(--muted-foreground))]"
                  data-testid="runs-empty"
                >
                  No pipeline runs recorded yet.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr
                  key={r.id}
                  data-testid="run-row"
                  data-run-id={r.id}
                  data-status={r.status}
                  className="border-t border-[hsl(var(--border-subtle))] transition-colors hover:bg-[hsl(var(--muted))]/30"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/runs/${r.id}`}
                      className="hover:underline"
                    >
                      {r.started_at
                        ? formatDateTime(r.started_at)
                        : formatDateTime(r.created_at)}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      data-testid={`run-status-${r.id}`}
                      className={`rounded-full px-2 py-[2px] text-[10px] font-medium ${STATUS_TONE[r.status]}`}
                    >
                      {r.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 tabular-nums text-[hsl(var(--muted-foreground))]">
                    {duration(r.started_at, r.finished_at)}
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    {r.rows_upserted ?? '—'}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-[hsl(var(--muted-foreground))]">
                    {r.args ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-[hsl(var(--muted-foreground))]">
                    {r.triggered_by_email ?? (
                      <span className="italic opacity-60">scheduled</span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-[hsl(var(--muted-foreground))]">
                    <Link
                      href={`/admin/runs/${r.id}`}
                      data-testid={`run-drill-${r.id}`}
                      className="hover:underline"
                    >
                      {r.id.slice(0, 8)}
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {pageCount > 1 && (
        <div
          data-testid="runs-pagination"
          className="flex items-center justify-between text-xs text-[hsl(var(--muted-foreground))]"
        >
          <span>
            Page {page + 1} of {pageCount} · {total} total
          </span>
          <div className="flex gap-2">
            {page > 0 && (
              <Link
                href={`/admin/runs?page=${page - 1}`}
                className="rounded-md border border-[hsl(var(--border))] px-3 py-1 hover:bg-[hsl(var(--muted))]"
              >
                ← Previous
              </Link>
            )}
            {page + 1 < pageCount && (
              <Link
                href={`/admin/runs?page=${page + 1}`}
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
