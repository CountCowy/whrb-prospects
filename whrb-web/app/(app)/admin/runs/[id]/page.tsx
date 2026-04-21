import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPipelineRun } from '@/lib/queries/admin';
import { formatDateTime } from '@/lib/time';

export const dynamic = 'force-dynamic';

const STATUS_TONE: Record<string, string> = {
  queued: 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]',
  running: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200',
  success: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  failed: 'bg-[hsl(var(--destructive))]/10 text-[hsl(var(--destructive))]',
};

const LEVEL_TONE: Record<string, string> = {
  debug: 'text-[hsl(var(--muted-foreground))]',
  info: 'text-[hsl(var(--foreground))]',
  warn: 'text-amber-700 dark:text-amber-300',
  error: 'text-[hsl(var(--destructive))]',
  fatal: 'text-[hsl(var(--destructive))] font-semibold',
};

type RouteParams = { params: Promise<{ id: string }> };

export default async function PipelineRunDetailPage({ params }: RouteParams) {
  const { id } = await params;
  const { run, events } = await getPipelineRun(id);
  if (!run) return notFound();

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/runs"
          className="text-xs text-[hsl(var(--muted-foreground))] hover:underline"
        >
          ← All runs
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
          Pipeline run
        </h1>
        <p className="font-mono text-xs text-[hsl(var(--muted-foreground))]">
          {run.id}
        </p>
      </div>

      <dl
        data-testid="run-summary"
        className="grid gap-4 rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--surface))] p-5 sm:grid-cols-2 md:grid-cols-3"
      >
        <div>
          <dt className="text-[11px] font-medium uppercase tracking-[0.14em] text-[hsl(var(--muted-foreground))]">
            Status
          </dt>
          <dd className="mt-1">
            <span
              data-testid="run-status"
              className={`rounded-full px-2 py-[2px] text-[10px] font-medium ${STATUS_TONE[run.status]}`}
            >
              {run.status}
            </span>
          </dd>
        </div>
        <div>
          <dt className="text-[11px] font-medium uppercase tracking-[0.14em] text-[hsl(var(--muted-foreground))]">
            Triggered by
          </dt>
          <dd className="mt-1 text-sm">
            {run.triggered_by_email ?? (
              <span className="italic text-[hsl(var(--muted-foreground))]">
                scheduled
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] font-medium uppercase tracking-[0.14em] text-[hsl(var(--muted-foreground))]">
            Args
          </dt>
          <dd className="mt-1 font-mono text-xs">{run.args ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-medium uppercase tracking-[0.14em] text-[hsl(var(--muted-foreground))]">
            Started
          </dt>
          <dd className="mt-1 text-sm">
            {run.started_at ? formatDateTime(run.started_at) : '—'}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] font-medium uppercase tracking-[0.14em] text-[hsl(var(--muted-foreground))]">
            Finished
          </dt>
          <dd className="mt-1 text-sm">
            {run.finished_at ? formatDateTime(run.finished_at) : '—'}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] font-medium uppercase tracking-[0.14em] text-[hsl(var(--muted-foreground))]">
            Rows upserted
          </dt>
          <dd className="mt-1 tabular-nums text-sm">{run.rows_upserted ?? '—'}</dd>
        </div>
        {run.error && (
          <div className="sm:col-span-2 md:col-span-3">
            <dt className="text-[11px] font-medium uppercase tracking-[0.14em] text-[hsl(var(--destructive))]">
              Error
            </dt>
            <dd
              data-testid="run-error"
              className="mt-1 whitespace-pre-wrap rounded-lg border border-[hsl(var(--destructive))]/30 bg-[hsl(var(--destructive))]/5 p-3 font-mono text-xs text-[hsl(var(--destructive))]"
            >
              {run.error}
            </dd>
          </div>
        )}
      </dl>

      <div>
        <h2 className="text-lg font-semibold tracking-tight">Events ({events.length})</h2>
        <div className="mt-3 overflow-hidden rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--surface))]">
          <table
            data-testid="run-events"
            className="w-full border-collapse text-sm"
          >
            <thead className="bg-[hsl(var(--muted))]/50 text-left text-[11px] font-medium uppercase tracking-[0.14em] text-[hsl(var(--muted-foreground))]">
              <tr>
                <th className="px-4 py-3">Time</th>
                <th className="px-4 py-3">Level</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Message</th>
              </tr>
            </thead>
            <tbody>
              {events.length === 0 ? (
                <tr>
                  <td
                    colSpan={4}
                    className="px-4 py-8 text-center text-[hsl(var(--muted-foreground))]"
                  >
                    No events linked to this run.
                  </td>
                </tr>
              ) : (
                events.map((e) => (
                  <tr
                    key={e.id}
                    data-testid="run-event-row"
                    data-event-level={e.level}
                    className="border-t border-[hsl(var(--border-subtle))]"
                  >
                    <td className="whitespace-nowrap px-4 py-2 font-mono text-[11px] text-[hsl(var(--muted-foreground))]">
                      {formatDateTime(e.created_at)}
                    </td>
                    <td className={`px-4 py-2 text-[11px] uppercase tracking-widest ${LEVEL_TONE[e.level]}`}>
                      {e.level}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-[hsl(var(--muted-foreground))]">
                      {e.category ?? '—'}
                    </td>
                    <td className="px-4 py-2 text-sm">{e.message}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
