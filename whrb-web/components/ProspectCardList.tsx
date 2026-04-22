import Link from 'next/link';
import type { Prospect } from '@/lib/queries/prospects';
import { TierBadge } from '@/components/TierBadge';
import { StateBadge } from '@/components/StateBadge';

type Props = {
  rows: Prospect[];
  emptyTitle?: string;
  emptyDescription?: string;
};

export function ProspectCardList({ rows, emptyTitle, emptyDescription }: Props) {
  if (rows.length === 0) {
    return (
      <div
        data-testid="prospect-card-list-empty"
        className="rounded-xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-8 text-center"
      >
        <h2 className="text-base font-semibold">{emptyTitle ?? 'No prospects.'}</h2>
        {emptyDescription ? (
          <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
            {emptyDescription}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <ul
      data-testid="prospect-card-list"
      className="divide-y divide-[hsl(var(--border-subtle))] overflow-hidden rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--surface))]"
    >
      {rows.map((p) => (
        <li key={p.id}>
          <Link
            href={`/prospects/${p.id}`}
            className="block p-4 transition-colors hover:bg-[hsl(var(--muted))]"
            data-testid="prospect-card"
            data-prospect-id={p.id}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-sm font-semibold">{p.company_name}</h3>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  {p.tier ? <TierBadge tier={p.tier} /> : null}
                  <StateBadge state={p.state} />
                  {p.is_nonprofit ? (
                    <span className="rounded-full bg-[hsl(var(--muted))] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
                      Nonprofit
                    </span>
                  ) : null}
                </div>
                <div className="mt-2 space-y-0.5 text-xs text-[hsl(var(--muted-foreground))]">
                  {p.category ? <p className="truncate">{p.category}</p> : null}
                  {p.contact_name || p.contact_email ? (
                    <p className="truncate">
                      {p.contact_name ?? ''}
                      {p.contact_name && p.contact_email ? ' · ' : ''}
                      {p.contact_email ?? ''}
                    </p>
                  ) : null}
                  {p.company_phone ? <p className="truncate">{p.company_phone}</p> : null}
                </div>
              </div>
              {p.priority_score !== null && p.priority_score !== undefined ? (
                <div className="shrink-0 text-right">
                  <span className="block text-[10px] font-medium uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
                    Score
                  </span>
                  <span className="text-sm font-semibold tabular-nums">
                    {p.priority_score}
                  </span>
                </div>
              ) : null}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
