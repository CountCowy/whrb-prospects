import { listSourceConfigs } from '@/lib/queries/admin';
import { formatDateTime } from '@/lib/time';
import { SourceToggle } from '@/components/admin/SourceToggle';

export const dynamic = 'force-dynamic';

export default async function AdminSourcesPage() {
  const rows = await listSourceConfigs();

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
          Toggle individual scrapers on or off. Disabled sources are skipped on
          the next pipeline run. Existing rows sourced from a disabled scraper
          remain in place but stop being refreshed.
        </p>
      </div>

      <div className="overflow-x-auto rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--surface))]">
        <table
          data-testid="sources-table"
          className="w-full min-w-[640px] border-collapse text-sm"
        >
          <thead className="bg-[hsl(var(--muted))]/50 text-left text-[11px] font-medium uppercase tracking-[0.14em] text-[hsl(var(--muted-foreground))]">
            <tr>
              <th className="px-4 py-3">Source</th>
              <th className="px-4 py-3">Enabled</th>
              <th className="px-4 py-3">Last updated</th>
              <th className="px-4 py-3">Updated by</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={4}
                  className="px-4 py-10 text-center text-[hsl(var(--muted-foreground))]"
                  data-testid="sources-empty"
                >
                  No source_config rows yet — run the pipeline once to seed them.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.source_key}
                  data-testid="source-row"
                  data-source-key={row.source_key}
                  data-enabled={row.enabled ? 'true' : 'false'}
                  className="border-t border-[hsl(var(--border-subtle))]"
                >
                  <td className="px-4 py-3 font-medium">{row.source_key}</td>
                  <td className="px-4 py-3">
                    <SourceToggle
                      sourceKey={row.source_key}
                      initialEnabled={row.enabled}
                    />
                  </td>
                  <td className="px-4 py-3 text-[hsl(var(--muted-foreground))]">
                    {formatDateTime(row.updated_at)}
                  </td>
                  <td className="px-4 py-3 text-[hsl(var(--muted-foreground))]">
                    {row.updated_by_email ?? (
                      <span className="italic opacity-60">system</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
