import Link from 'next/link';
import { redirect } from 'next/navigation';
import { SourceLifecycleButton } from '@/components/admin/SourceLifecycleButton';
import { SourceStatusBadge } from '@/components/admin/SourceStatusBadge';
import {
  listSourceMetrics,
  listSourceSampleRows,
} from '@/lib/queries/sources';
import { createClient } from '@/lib/supabase/server';
import { formatDateTime } from '@/lib/time';

export const dynamic = 'force-dynamic';

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

export default async function AdminSourceDetailPage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const { key } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  if (profile?.role !== 'admin') redirect('/');

  const allMetrics = await listSourceMetrics();
  const metric = allMetrics.find((m) => m.source_key === key);
  const samples = await listSourceSampleRows(key, 25);

  return (
    <div data-testid="admin-source-detail" className="space-y-6">
      <nav
        aria-label="Breadcrumb"
        className="text-xs text-[hsl(var(--muted-foreground))]"
      >
        <Link href="/admin/sources" className="hover:underline">
          Pipeline sources
        </Link>
        <span aria-hidden="true"> / </span>
        <span aria-current="page">{key}</span>
      </nav>

      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-1">
          <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-[hsl(var(--muted-foreground))]">
            Source
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">{key}</h1>
        </div>
        {metric ? (
          <>
            <SourceStatusBadge status={metric.status} />
            <SourceLifecycleButton
              sourceKey={metric.source_key}
              status={metric.status}
            />
          </>
        ) : (
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            Source has no <code>source_config</code> row yet.
          </p>
        )}
      </div>

      {metric ? (
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Close rate" value={pct(metric.close_rate)} hint={`${metric.closed} of ${metric.contributed} contributed`} testid="detail-close" />
          <Metric label="Duplicate rate" value={pct(metric.duplicate_rate)} hint={`${metric.losses} losing-side merges`} testid="detail-duplicate" />
          <Metric label="Searched rate" value={pct(metric.searched_rate)} hint={`${metric.searched} of ${metric.contributed} ever filtered`} testid="detail-searched" />
          <Metric
            label="Rows last run"
            value={metric.rows_last_run.toLocaleString()}
            hint={
              metric.last_seen_at
                ? `Last seen ${formatDateTime(metric.last_seen_at)}`
                : 'Never observed'
            }
            testid="detail-rows-last-run"
          />
        </section>
      ) : null}

      <section
        data-testid="source-samples"
        className="space-y-3"
        aria-labelledby="samples-heading"
      >
        <h2
          id="samples-heading"
          className="text-sm font-semibold uppercase tracking-[0.14em] text-[hsl(var(--muted-foreground))]"
        >
          Sample rows ({samples.length})
        </h2>
        {samples.length === 0 ? (
          <div className="rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--surface))] p-6 text-sm text-[hsl(var(--muted-foreground))]">
            No prospects currently attribute to this source.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--surface))]">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead className="bg-[hsl(var(--muted))]/50 text-left text-[11px] font-medium uppercase tracking-[0.14em] text-[hsl(var(--muted-foreground))]">
                <tr>
                  <th className="px-4 py-3">Company</th>
                  <th className="px-4 py-3">State</th>
                  <th className="px-4 py-3">ZIP</th>
                  <th className="px-4 py-3">Source mix</th>
                  <th className="px-4 py-3">Last seen</th>
                </tr>
              </thead>
              <tbody>
                {samples.map((row) => (
                  <tr
                    key={row.id}
                    data-testid="source-sample-row"
                    data-prospect-id={row.id}
                    className="border-t border-[hsl(var(--border-subtle))]"
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/prospects/${row.id}`}
                        className="font-medium text-[hsl(var(--primary))] underline-offset-2 hover:underline"
                      >
                        {row.company_name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-[hsl(var(--muted-foreground))]">
                      {row.state}
                    </td>
                    <td className="px-4 py-3 text-[hsl(var(--muted-foreground))]">
                      {row.zip ?? '—'}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-[hsl(var(--muted-foreground))]">
                      {row.source ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-[hsl(var(--muted-foreground))]">
                      {row.pipeline_last_seen_at
                        ? formatDateTime(row.pipeline_last_seen_at)
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Metric({
  label,
  value,
  hint,
  testid,
}: {
  label: string;
  value: string;
  hint?: string;
  testid: string;
}) {
  return (
    <div
      data-testid={testid}
      className="rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--surface))] px-4 py-3"
    >
      <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[hsl(var(--muted-foreground))]">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
        {value}
      </div>
      {hint ? (
        <div className="mt-1 text-[11px] text-[hsl(var(--muted-foreground))]">
          {hint}
        </div>
      ) : null}
    </div>
  );
}
