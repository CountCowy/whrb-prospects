import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { listChangelogEntries } from '@/lib/queries/changelog';
import { formatInTz } from '@/lib/time';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function ChangelogPage() {
  const entries = await listChangelogEntries();

  // Detect admin role for the "Manage" link.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  let isAdmin = false;
  if (user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();
    isAdmin = profile?.role === 'admin';
  }

  // Pinned entries float to top for 14 days past `released_at` per plan.
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const visibleEntries = entries.filter(
    (e) => !e.pinned || new Date(e.released_at) > fourteenDaysAgo,
  );

  return (
    <div
      data-testid="changelog-page"
      className="mx-auto max-w-3xl space-y-8 py-8"
    >
      <header className="flex items-end justify-between gap-4">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-[hsl(var(--muted-foreground))]">
            What&apos;s new
          </div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">
            Changelog
          </h1>
          <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">
            Product updates that affect day-to-day rep work.
          </p>
        </div>
        {isAdmin ? (
          <Link
            href="/admin/changelog"
            className="text-sm text-[hsl(var(--primary))] underline-offset-2 hover:underline"
            data-testid="changelog-admin-link"
          >
            Manage entries &rarr;
          </Link>
        ) : null}
      </header>

      {visibleEntries.length === 0 ? (
        <div
          data-testid="changelog-empty"
          className="rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--surface))] p-6 text-sm text-[hsl(var(--muted-foreground))]"
        >
          No changelog entries yet.
        </div>
      ) : (
        <ol className="space-y-6">
          {visibleEntries.map((entry) => {
            const isPinned =
              entry.pinned && new Date(entry.released_at) > fourteenDaysAgo;
            return (
              <li
                key={entry.id}
                data-testid="changelog-entry"
                data-slug={entry.slug}
                data-audience={entry.audience}
                className="space-y-3 rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--surface))] p-6"
              >
                <div className="flex flex-wrap items-center gap-2">
                  {isPinned ? (
                    <Badge
                      variant="outline"
                      className="border-[hsl(var(--primary-soft-border))] bg-[hsl(var(--primary-soft))] text-[hsl(var(--primary))]"
                      data-testid="changelog-pinned-badge"
                    >
                      Pinned
                    </Badge>
                  ) : null}
                  {entry.audience !== 'all' ? (
                    <Badge variant="secondary" data-testid="changelog-audience-badge">
                      {entry.audience}
                    </Badge>
                  ) : null}
                  <span className="text-[11px] uppercase tracking-[0.14em] text-[hsl(var(--muted-foreground))]">
                    {formatInTz(entry.released_at, 'MMMM d, yyyy')}
                  </span>
                </div>
                <h2 className="text-xl font-semibold tracking-tight">
                  {entry.title}
                </h2>
                <div
                  className="prose prose-sm max-w-none whitespace-pre-wrap text-sm leading-relaxed text-foreground"
                  data-testid="changelog-body"
                >
                  {entry.body_mdx}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
