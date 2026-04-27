import Link from 'next/link';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SourceToggle } from '@/components/admin/SourceToggle';
import { SourceLifecycleButton } from '@/components/admin/SourceLifecycleButton';
import { SourceStatusBadge } from '@/components/admin/SourceStatusBadge';
import {
  listSourceMetrics,
  listReviewCandidates,
  type SourceStatus,
} from '@/lib/queries/sources';
import { formatDateTime } from '@/lib/time';

export const dynamic = 'force-dynamic';

function pct(n: number): string {
  return `${(n * 100).toFixed(0)}%`;
}

/**
 * Renders the sunset countdown text per plan §6.4 ("Sunsets in N days
 * unless reverted", "Archives in N days"). Only meaningful for the two
 * transitional states; returns null otherwise.
 */
function CountdownText({
  status,
  changedAt,
}: {
  status: SourceStatus;
  changedAt: string;
}) {
  if (status !== 'sunset_proposed' && status !== 'sunset') return null;
  const baseMs = new Date(changedAt).getTime();
  const targetMs =
    status === 'sunset_proposed'
      ? baseMs + 15 * 24 * 60 * 60 * 1000
      : baseMs + 30 * 24 * 60 * 60 * 1000;
  const remainingMs = targetMs - Date.now();
  const remainingDays = Math.max(0, Math.ceil(remainingMs / (24 * 60 * 60 * 1000)));
  const noun = status === 'sunset_proposed' ? 'Sunsets' : 'Archives';
  return (
    <span
      data-testid="source-countdown"
      data-status={status}
      data-days={remainingDays}
      className="text-[11px] text-[hsl(var(--muted-foreground))]"
    >
      {noun} in {remainingDays} day{remainingDays === 1 ? '' : 's'} unless reverted
    </span>
  );
}

export default async function AdminSourcesPage() {
  const [metrics, candidates] = await Promise.all([
    listSourceMetrics(),
    listReviewCandidates(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-[hsl(var(--muted-foreground))]">
          Admin
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
          Pipeline sources
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-[hsl(var(--muted-foreground))]">
          Source-quality metrics, lifecycle controls, and per-source drill-downs.
          Sources in <code>sunset_proposed</code> still run; <code>sunset</code>{' '}
          and <code>archived</code> are skipped.{' '}
          <span className="italic">
            Close-rate: a won prospect credits every source that contributed to
            it. Cross-source totals may exceed 100%.
          </span>
        </p>
      </div>

      <Tabs defaultValue="all" data-testid="sources-tabs">
        <TabsList>
          <TabsTrigger value="all" data-testid="sources-tab-all">
            All sources ({metrics.length})
          </TabsTrigger>
          <TabsTrigger value="review" data-testid="sources-tab-review">
            Review candidates ({candidates.length})
          </TabsTrigger>
        </TabsList>
        <TabsContent value="all" className="space-y-3 pt-4">
          <div className="overflow-x-auto rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--surface))]">
            <table
              data-testid="sources-table"
              className="w-full min-w-[1024px] border-collapse text-sm"
            >
              <thead className="bg-[hsl(var(--muted))]/50 text-left text-[11px] font-medium uppercase tracking-[0.14em] text-[hsl(var(--muted-foreground))]">
                <tr>
                  <th scope="col" className="px-4 py-3">Source</th>
                  <th scope="col" className="px-4 py-3">Status</th>
                  <th scope="col" className="px-4 py-3">Enabled</th>
                  <th
                    scope="col"
                    className="px-4 py-3 text-right"
                    title="Won prospects credit every source that contributed via dedupe."
                  >
                    Close rate
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 text-right"
                    title="Fraction of contributions that were merged into another row."
                  >
                    Duplicate rate
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 text-right"
                    title="Fraction of rows ever seen via a non-default filter."
                  >
                    Searched rate
                  </th>
                  <th scope="col" className="px-4 py-3 text-right">Rows last run</th>
                  <th scope="col" className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {metrics.length === 0 ? (
                  <tr>
                    <td
                      colSpan={8}
                      className="px-4 py-10 text-center text-[hsl(var(--muted-foreground))]"
                      data-testid="sources-empty"
                    >
                      No source_config rows yet — run the pipeline once to seed them.
                    </td>
                  </tr>
                ) : (
                  metrics.map((row) => (
                    <tr
                      key={row.source_key}
                      data-testid="source-row"
                      data-source-key={row.source_key}
                      data-status={row.status}
                      data-enabled={row.enabled ? 'true' : 'false'}
                      className="border-t border-[hsl(var(--border-subtle))]"
                    >
                      <td className="px-4 py-3">
                        <Link
                          href={`/admin/sources/${row.source_key}`}
                          className="font-medium text-[hsl(var(--primary))] underline-offset-2 hover:underline"
                          data-testid="source-row-name"
                        >
                          {row.source_key}
                        </Link>
                        <div className="mt-1">
                          <CountdownText
                            status={row.status}
                            changedAt={row.status_changed_at}
                          />
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <SourceStatusBadge status={row.status} />
                      </td>
                      <td className="px-4 py-3">
                        <SourceToggle
                          sourceKey={row.source_key}
                          initialEnabled={row.enabled}
                        />
                      </td>
                      <td
                        className="px-4 py-3 text-right tabular-nums"
                        data-testid="source-close-rate"
                      >
                        {pct(row.close_rate)}
                        <span className="ml-1 text-[11px] text-[hsl(var(--muted-foreground))]">
                          ({row.closed}/{row.contributed})
                        </span>
                      </td>
                      <td
                        className="px-4 py-3 text-right tabular-nums"
                        data-testid="source-duplicate-rate"
                      >
                        {pct(row.duplicate_rate)}
                        <span className="ml-1 text-[11px] text-[hsl(var(--muted-foreground))]">
                          ({row.losses})
                        </span>
                      </td>
                      <td
                        className="px-4 py-3 text-right tabular-nums"
                        data-testid="source-searched-rate"
                      >
                        {pct(row.searched_rate)}
                      </td>
                      <td
                        className="px-4 py-3 text-right tabular-nums"
                        data-testid="source-rows-last-run"
                      >
                        {row.rows_last_run.toLocaleString()}
                      </td>
                      <td className="px-4 py-3">
                        <SourceLifecycleButton
                          sourceKey={row.source_key}
                          status={row.status}
                        />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="review" className="space-y-3 pt-4">
          <div
            data-testid="review-candidates-panel"
            className="space-y-3"
          >
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              Sources that match the §6.4 sunset trigger criteria
              (<code>searched_rate</code> &lt; 5% with zero close rate, or 3+
              <code> bot_detected_skip</code> events in the last 4 runs).
              Click <strong>Propose sunset</strong> to start the 15-day
              auto-promotion window.
            </p>
            {candidates.length === 0 ? (
              <div
                data-testid="review-candidates-empty"
                className="rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--surface))] p-6 text-sm text-[hsl(var(--muted-foreground))]"
              >
                No active sources match the trigger criteria.
              </div>
            ) : (
              <ul className="space-y-2">
                {candidates.map((c) => (
                  <li
                    key={c.source_key}
                    data-testid="review-candidate"
                    data-source-key={c.source_key}
                    className="rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--surface))] p-4"
                  >
                    <div className="flex flex-wrap items-center gap-3">
                      <Link
                        href={`/admin/sources/${c.source_key}`}
                        className="font-medium text-[hsl(var(--primary))] underline-offset-2 hover:underline"
                      >
                        {c.source_key}
                      </Link>
                      <SourceStatusBadge status={c.status} />
                      <span className="ml-auto text-[11px] text-[hsl(var(--muted-foreground))]">
                        {pct(c.close_rate)} close · {pct(c.searched_rate)} searched
                      </span>
                    </div>
                    <ul className="mt-2 list-disc pl-5 text-sm text-[hsl(var(--muted-foreground))]">
                      {c.reasons.map((r) => (
                        <li key={r} data-testid="review-candidate-reason">
                          {r}
                        </li>
                      ))}
                    </ul>
                    <div className="mt-3">
                      <SourceLifecycleButton
                        sourceKey={c.source_key}
                        status={c.status}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </TabsContent>
      </Tabs>

      <p
        data-testid="sources-last-updated"
        className="text-[11px] text-[hsl(var(--muted-foreground))]"
      >
        Most recent <code>source_config</code> update:{' '}
        {metrics.length > 0
          ? formatDateTime(
              metrics
                .map((m) => m.updated_at)
                .sort()
                .reverse()[0],
            )
          : '—'}
      </p>
    </div>
  );
}
