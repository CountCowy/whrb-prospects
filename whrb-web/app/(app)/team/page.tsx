import Link from 'next/link';
import { listProfilesWithCounts } from '@/lib/queries/profiles';
import { formatDate } from '@/lib/time';

export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;

function firstString(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

const SORTS = [
  { key: 'name', label: 'Name' },
  { key: 'assigned', label: 'Assigned' },
  { key: 'sold', label: 'Sold' },
  { key: 'joined', label: 'Joined' },
] as const;

function initials(p: { email: string; display_name: string | null }): string {
  const base = (p.display_name ?? p.email.split('@')[0]).trim();
  const parts = base.split(/[\s._-]+/).filter(Boolean).slice(0, 2);
  return parts.map((s) => s[0]?.toUpperCase() ?? '').join('') || base[0]?.toUpperCase() || '?';
}

export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const sort = firstString(sp.sort) ?? 'name';

  const members = await listProfilesWithCounts();
  const sorted = [...members].sort((a, b) => {
    if (sort === 'assigned') return b.assigned_count - a.assigned_count;
    if (sort === 'sold') return b.sold_count - a.sold_count;
    if (sort === 'joined') return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    const aLabel = (a.display_name ?? a.email).toLowerCase();
    const bLabel = (b.display_name ?? b.email).toLowerCase();
    return aLabel.localeCompare(bLabel);
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-[hsl(var(--muted-foreground))]">
            Directory
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">Team</h1>
        </div>
        <div className="flex items-center gap-2">
          <span
            className="text-[11px] font-medium uppercase tracking-widest text-[hsl(var(--muted-foreground))]"
            aria-hidden="true"
          >
            Sort by
          </span>
          <div
            role="tablist"
            aria-label="Sort team members by"
            data-testid="team-sort"
            className="inline-flex rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-0.5"
          >
            {SORTS.map((s) => {
              const active = sort === s.key;
              return (
                <Link
                  key={s.key}
                  href={`/team?sort=${s.key}`}
                  role="tab"
                  aria-selected={active}
                  data-testid={`team-sort-${s.key}`}
                  className={`inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    active
                      ? 'bg-[hsl(var(--primary-soft))] text-[hsl(var(--primary))]'
                      : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]'
                  }`}
                >
                  {s.label}
                  {active ? (
                    <svg
                      viewBox="0 0 24 24"
                      width="10"
                      height="10"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                  ) : null}
                </Link>
              );
            })}
          </div>
        </div>
      </div>
      <div
        data-testid="team-summary"
        className="text-xs text-[hsl(var(--muted-foreground))]"
      >
        {members.length} member{members.length === 1 ? '' : 's'} ·{' '}
        {members.filter((m) => m.role === 'admin').length} admin
      </div>
      <ul
        data-testid="team-grid"
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
      >
        {sorted.map((m) => (
          <li
            key={m.id}
            data-testid="team-member"
            data-profile-id={m.id}
            data-role={m.role}
            className="group relative overflow-hidden rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--surface))] p-5 shadow-[var(--shadow-sm)] transition-shadow hover:shadow-[var(--shadow-md)]"
          >
            <div
              aria-hidden="true"
              className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-[hsl(var(--primary))] to-transparent opacity-40 transition-opacity group-hover:opacity-80"
            />
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--primary-soft))] text-sm font-semibold text-[hsl(var(--primary))]">
                {initials(m)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium text-[hsl(var(--foreground))]">
                    {m.display_name || m.email.split('@')[0]}
                  </span>
                  {m.role === 'admin' && (
                    <span
                      data-testid="admin-pill"
                      className="rounded-full border border-[hsl(var(--primary-soft-border))] bg-[hsl(var(--primary-soft))] px-2 py-[1px] text-[10px] font-medium uppercase tracking-widest text-[hsl(var(--primary))]"
                    >
                      Admin
                    </span>
                  )}
                </div>
                <div className="truncate text-[11px] text-[hsl(var(--muted-foreground))]">
                  {m.email}
                </div>
                <div className="mt-1 text-[11px] text-[hsl(var(--muted-foreground))]">
                  Joined {formatDate(m.created_at)}
                </div>
              </div>
            </div>
            <div className="mt-4 flex items-center gap-4 text-sm">
              <div>
                <div className="text-[11px] font-medium uppercase tracking-widest text-[hsl(var(--muted-foreground))]">
                  Assigned
                </div>
                <div
                  className="mt-0.5 text-lg font-semibold tabular-nums"
                  data-testid={`team-member-assigned-${m.id}`}
                >
                  {m.assigned_count}
                </div>
              </div>
              <div>
                <div className="text-[11px] font-medium uppercase tracking-widest text-[hsl(var(--muted-foreground))]">
                  Sold
                </div>
                <div
                  className="mt-0.5 text-lg font-semibold tabular-nums"
                  data-testid={`team-member-sold-${m.id}`}
                >
                  {m.sold_count}
                </div>
              </div>
              <Link
                href={`/prospects?assigned_to=${m.id}`}
                data-testid={`team-member-link-${m.id}`}
                className="ml-auto self-end rounded-md border border-[hsl(var(--border))] px-2.5 py-1 text-xs font-medium text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"
              >
                View prospects →
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
