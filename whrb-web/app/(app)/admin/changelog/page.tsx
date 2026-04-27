import { redirect } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { listChangelogEntries } from '@/lib/queries/changelog';
import { ChangelogAdminEditor } from '@/components/admin/ChangelogAdminEditor';
import { createClient } from '@/lib/supabase/server';
import { formatInTz } from '@/lib/time';

export const dynamic = 'force-dynamic';

export default async function AdminChangelogPage() {
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

  const entries = await listChangelogEntries();

  return (
    <div
      data-testid="admin-changelog-page"
      className="space-y-6"
    >
      <div>
        <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-[hsl(var(--muted-foreground))]">
          Admin
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
          Changelog
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-[hsl(var(--muted-foreground))]">
          Publish a changelog entry. Reps see entries marked{' '}
          <code>audience: rep</code> or <code>audience: all</code>; admins
          see everything. The first time a rep loads the app after a new
          entry is published, a one-time toast points them to{' '}
          <code>/changelog</code>.
        </p>
      </div>

      <ChangelogAdminEditor />

      <section
        data-testid="admin-changelog-list"
        className="space-y-3"
        aria-labelledby="admin-changelog-list-heading"
      >
        <h2
          id="admin-changelog-list-heading"
          className="text-sm font-semibold uppercase tracking-[0.14em] text-[hsl(var(--muted-foreground))]"
        >
          All entries
        </h2>
        {entries.length === 0 ? (
          <div
            data-testid="admin-changelog-empty"
            className="rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--surface))] p-6 text-sm text-[hsl(var(--muted-foreground))]"
          >
            No changelog entries yet — create the first one above.
          </div>
        ) : (
          <ol className="space-y-3">
            {entries.map((entry) => (
              <li
                key={entry.id}
                data-testid="admin-changelog-entry"
                data-slug={entry.slug}
                className="rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--surface))] p-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  {entry.pinned ? (
                    <Badge
                      variant="outline"
                      className="border-[hsl(var(--primary-soft-border))] bg-[hsl(var(--primary-soft))] text-[hsl(var(--primary))]"
                    >
                      Pinned
                    </Badge>
                  ) : null}
                  <Badge variant="secondary">{entry.audience}</Badge>
                  <span className="text-[11px] uppercase tracking-[0.14em] text-[hsl(var(--muted-foreground))]">
                    {formatInTz(entry.released_at, 'MMM d, yyyy h:mm a')}
                  </span>
                  <span className="ml-auto text-[11px] font-mono text-[hsl(var(--muted-foreground))]">
                    {entry.slug}
                  </span>
                </div>
                <h3 className="mt-2 text-base font-semibold">{entry.title}</h3>
                <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))] line-clamp-3 whitespace-pre-wrap">
                  {entry.body_mdx}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
